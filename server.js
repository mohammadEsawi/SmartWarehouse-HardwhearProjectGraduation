// FILE: server.js - COMPLETE FIXED VERSION
import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import WebSocket, { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5001;

// ======== MIDDLEWARE ========
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ======== DATABASE CONFIG ========
const dbConfig = {
  host: "localhost",
  port: 3000,
  user: "root",
  password: "123456",
  database: "smart_warehouse",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// ======== ESP32 CONFIG ========
let ESP32_BASE_URL = null;
let isESP32Connected = false;

// Current sensor data
let currentSensorData = {
  ldr1: false,
  ldr2: false,
  rfid: null,
  conveyorState: "IDLE",
  lastUpdate: null
};

// Arm state
const armState = {
  status: "READY",
  mode: "manual",
  currentOperation: null,
  currentCell: null,
  currentProduct: null
};

// ======== WEBSOCKET SERVER ========
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("WebSocket client connected");

  ws.send(JSON.stringify({
    type: "init",
    armState,
    sensorData: currentSensorData,
    esp32Connected: isESP32Connected,
    timestamp: new Date().toISOString()
  }));

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);
      handleClientMessage(ws, message);
    } catch (error) {
      console.error("Error parsing client message:", error);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log("WebSocket client disconnected");
  });
});

function handleClientMessage(ws, message) {
  switch (message.type) {
    case "request_sensor_data":
    case "request_sensor_update":
      ws.send(JSON.stringify({
        type: "sensor_update",
        data: currentSensorData
      }));
      break;
    case "refresh_data":
      broadcastWarehouseData();
      break;
    default:
      console.log("Unknown client message:", message);
  }
}

// ======== DATABASE INITIALIZATION ========
async function initializeDatabase() {
  try {
    console.log("Initializing database...");
    
    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cells (
        id INT AUTO_INCREMENT PRIMARY KEY,
        row_num INT NOT NULL,
        col_num INT NOT NULL,
        label VARCHAR(50) NOT NULL,
        product_id INT NULL,
        quantity INT DEFAULT 0,
        status ENUM('EMPTY', 'OCCUPIED', 'RESERVED') DEFAULT 'EMPTY',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE (row_num, col_num)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        sku VARCHAR(100) NULL,
        rfid_uid VARCHAR(100) NULL,
        category VARCHAR(50) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS operations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        op_type ENUM(
          'HOME',
          'PICK_FROM_CONVEYOR',
          'PLACE_IN_CELL',
          'TAKE_FROM_CELL',
          'GOTO_COLUMN',
          'MANUAL_CMD',
          'MOVE_TO_LOADING',
          'RETURN_TO_LOADING',
          'AUTO_STOCK',
          'AUTO_RETRIEVE'
        ) NOT NULL,
        product_id INT NULL,
        cell_id INT NULL,
        cmd VARCHAR(100) NOT NULL,
        status ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'ERROR', 'CANCELLED') DEFAULT 'PENDING',
        error_message VARCHAR(255) NULL,
        execution_time_ms INT NULL,
        priority ENUM('LOW', 'MEDIUM', 'HIGH') DEFAULT 'MEDIUM',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loading_zone (
        id INT PRIMARY KEY DEFAULT 1,
        product_id INT NULL,
        quantity INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS conveyor_status (
        id INT PRIMARY KEY DEFAULT 1,
        has_product BOOLEAN DEFAULT FALSE,
        product_id INT NULL,
        product_rfid VARCHAR(100) NULL,
        last_detected_at TIMESTAMP NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        task_type ENUM('STOCK', 'RETRIEVE', 'MOVE', 'ORGANIZE', 'INVENTORY_CHECK') NOT NULL,
        cell_id INT NULL,
        product_id INT NULL,
        product_rfid VARCHAR(100) NULL,
        quantity INT DEFAULT 1,
        priority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') DEFAULT 'MEDIUM',
        status ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING',
        parameters JSON NULL,
        scheduled_at TIMESTAMP NULL,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        error_message VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Initialize cells (3 rows x 4 columns)
    const [cellsCount] = await pool.query("SELECT COUNT(*) as count FROM cells");
    if (cellsCount[0].count === 0) {
      const cells = [];
      for (let r = 1; r <= 3; r++) {
        for (let c = 1; c <= 4; c++) {
          cells.push([r, c, `R${r}C${c}`]);
        }
      }
      await pool.query("INSERT INTO cells (row_num, col_num, label) VALUES ?", [cells]);
      console.log("Seeded cells table");
    }

    // Initialize loading zone
    const [loadingZoneCount] = await pool.query("SELECT COUNT(*) as count FROM loading_zone WHERE id = 1");
    if (loadingZoneCount[0].count === 0) {
      await pool.query("INSERT INTO loading_zone (id, product_id, quantity) VALUES (1, NULL, 0)");
      console.log("Seeded loading_zone table");
    }

    // Initialize conveyor status
    const [conveyorCount] = await pool.query("SELECT COUNT(*) as count FROM conveyor_status WHERE id = 1");
    if (conveyorCount[0].count === 0) {
      await pool.query("INSERT INTO conveyor_status (id, has_product, product_id) VALUES (1, FALSE, NULL)");
      console.log("Seeded conveyor_status table");
    }

    console.log("✅ Database initialized successfully");
    
  } catch (err) {
    console.error("Error initializing DB:", err);
  }
}

// ======== ESP32 REGISTRATION ========
app.get("/api/esp32/register", (req, res) => {
  const { ip } = req.query;
  if (!ip) {
    return res.status(400).json({
      success: false,
      error: "Missing 'ip' query parameter"
    });
  }

  ESP32_BASE_URL = `http://${ip}`;
  isESP32Connected = true;
  console.log(`✅ ESP32 registered at ${ESP32_BASE_URL}`);

  broadcast({
    type: "esp32_status",
    connected: true,
    url: ESP32_BASE_URL
  });

  res.json({
    success: true,
    esp32_base_url: ESP32_BASE_URL,
    message: "ESP32 registered successfully"
  });
});

app.get("/api/esp32/status", (req, res) => {
  res.json({
    connected: isESP32Connected,
    url: ESP32_BASE_URL,
    last_sensor_update: currentSensorData.lastUpdate
  });
});

// ======== HELPER: SEND COMMAND TO ESP32 ========
async function sendCommandToESP32(command) {
  if (!ESP32_BASE_URL) {
    throw new Error("ESP32 not registered. Use /api/esp32/register");
  }

  const url = `${ESP32_BASE_URL}/cmd?c=${encodeURIComponent(command)}`;
  console.log(`[Node → ESP32] ${command}`);

  try {
    const resp = await fetch(url, { timeout: 10000 });
    const text = await resp.text();

    if (!resp.ok) {
      throw new Error(`ESP32 HTTP ${resp.status}: ${text}`);
    }

    return { success: true, message: text };
  } catch (err) {
    console.error("Error sending command to ESP32:", err.message);
    isESP32Connected = false;
    throw err;
  }
}

// ======== SENSOR API ========
app.post("/api/sensors/update", async (req, res) => {
  try {
    const { ldr1, ldr2, rfid, conveyorState } = req.body;

    currentSensorData = {
      ldr1: !!ldr1,
      ldr2: !!ldr2,
      rfid: rfid || null,
      conveyorState: conveyorState || "IDLE",
      lastUpdate: new Date().toISOString()
    };

    broadcast({
      type: "sensor_update",
      data: currentSensorData
    });

    // Update conveyor status based on sensors
    if (ldr1 || ldr2) {
      await pool.query(
        "UPDATE conveyor_status SET has_product = TRUE, last_detected_at = NOW() WHERE id = 1"
      );
      
      // If RFID detected, update product association
      if (rfid) {
        const [products] = await pool.query(
          "SELECT * FROM products WHERE rfid_uid = ?",
          [rfid]
        );

        if (products.length > 0) {
          const product = products[0];
          await pool.query(
            "UPDATE conveyor_status SET product_id = ?, product_rfid = ? WHERE id = 1",
            [product.id, rfid]
          );

          broadcast({
            type: "rfid_detected",
            tag: rfid,
            symbol: product.name ? product.name.charAt(0).toUpperCase() : "?",
            product: product,
            targetCell: null
          });
        }
      }
    } else {
      await pool.query(
        "UPDATE conveyor_status SET has_product = FALSE, last_detected_at = NOW() WHERE id = 1"
      );
    }

    // Update conveyor status broadcast
    const [conveyorRows] = await pool.query(`
      SELECT cs.*, p.name as product_name, p.sku
      FROM conveyor_status cs
      LEFT JOIN products p ON cs.product_id = p.id
      WHERE cs.id = 1
    `);
    
    broadcast({
      type: "conveyor_update",
      product: conveyorRows[0]
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error updating sensors:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/sensors", async (req, res) => {
  res.json(currentSensorData);
});

// ======== CONVEYOR STATUS API ========
app.get("/api/conveyor-status", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT cs.*, p.name as product_name, p.sku, p.rfid_uid
      FROM conveyor_status cs
      LEFT JOIN products p ON cs.product_id = p.id
      WHERE cs.id = 1
    `);
    
    const data = rows[0] || { 
      id: 1, 
      has_product: false, 
      product_id: null, 
      product_name: null,
      product_rfid: null,
      last_detected_at: null,
      updated_at: new Date().toISOString()
    };
    
    res.json(data);
  } catch (err) {
    console.error("Error getting conveyor status:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/conveyor-status", async (req, res) => {
  try {
    const { has_product, product_id, product_rfid } = req.body;

    await pool.query(
      `
      INSERT INTO conveyor_status (id, has_product, product_id, product_rfid, last_detected_at)
      VALUES (1, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE 
        has_product = ?, 
        product_id = ?,
        product_rfid = ?,
        last_detected_at = NOW()
      `,
      [has_product, product_id || null, product_rfid || null, 
       has_product, product_id || null, product_rfid || null]
    );

    const [rows] = await pool.query(`
      SELECT cs.*, p.name as product_name, p.sku
      FROM conveyor_status cs
      LEFT JOIN products p ON cs.product_id = p.id
      WHERE cs.id = 1
    `);

    const data = rows[0] || { id: 1, has_product: false, product_id: null };
    broadcast({ type: "conveyor_update", product: data });
    res.json(data);
  } catch (err) {
    console.error("Error updating conveyor:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ======== LOADING ZONE API ========
app.get("/api/loading-zone", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT lz.*, p.name AS product_name, p.sku, p.rfid_uid
      FROM loading_zone lz
      LEFT JOIN products p ON lz.product_id = p.id
      WHERE lz.id = 1
    `);
    
    const data = rows[0] || { 
      id: 1, 
      product_id: null, 
      product_name: null,
      sku: null,
      rfid_uid: null,
      quantity: 0,
      updated_at: new Date().toISOString()
    };
    
    res.json(data);
  } catch (err) {
    console.error("Error /api/loading-zone GET:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/loading-zone", async (req, res) => {
  try {
    const { product_id, quantity } = req.body;

    await pool.query(
      `
      INSERT INTO loading_zone (id, product_id, quantity, updated_at)
      VALUES (1, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE 
        product_id = ?, 
        quantity = ?,
        updated_at = NOW()
    `,
      [product_id, quantity || 0, product_id, quantity || 0]
    );

    const [rows] = await pool.query(`
      SELECT lz.*, p.name AS product_name, p.sku, p.rfid_uid
      FROM loading_zone lz
      LEFT JOIN products p ON lz.product_id = p.id
      WHERE lz.id = 1
    `);

    const data = rows[0];
    broadcast({ type: "loading_zone_update", data });
    res.json(data);
  } catch (err) {
    console.error("Error /api/loading-zone POST:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ======== CELLS API ========
app.get("/api/cells", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.*,
        p.name AS product_name,
        p.sku,
        p.rfid_uid,
        CASE 
          WHEN c.product_id IS NOT NULL THEN 'OCCUPIED' 
          ELSE 'EMPTY' 
        END AS display_status
      FROM cells c
      LEFT JOIN products p ON c.product_id = p.id
      ORDER BY c.row_num, c.col_num
    `);
    res.json(rows);
  } catch (err) {
    console.error("Error /api/cells:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/cells/:cellId/assign", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { cellId } = req.params;
    const { product_id, quantity } = req.body;

    // Get current cell status
    const [currentCell] = await connection.query(
      "SELECT * FROM cells WHERE id = ?",
      [cellId]
    );

    if (currentCell.length === 0) {
      throw new Error("Cell not found");
    }

    // Update cell
    if (product_id) {
      await connection.query(
        `UPDATE cells 
         SET product_id = ?, 
             quantity = ?,
             status = 'OCCUPIED',
             updated_at = NOW()
         WHERE id = ?`,
        [product_id, quantity || 1, cellId]
      );
    } else {
      await connection.query(
        `UPDATE cells 
         SET product_id = NULL,
             quantity = 0,
             status = 'EMPTY',
             updated_at = NOW()
         WHERE id = ?`,
        [cellId]
      );
    }

    // Log operation
    await connection.query(
      "INSERT INTO operations (op_type, cmd, product_id, cell_id, status) VALUES (?, ?, ?, ?, ?)",
      ['MANUAL_CMD', `ASSIGN_CELL:${cellId}`, product_id || null, cellId, 'COMPLETED']
    );

    await connection.commit();

    // Get updated cell data
    const [updatedRows] = await pool.query(`
      SELECT 
        c.*,
        p.name AS product_name,
        p.sku,
        p.rfid_uid
      FROM cells c
      LEFT JOIN products p ON c.product_id = p.id
      WHERE c.id = ?
    `, [cellId]);

    broadcast({
      type: "cell_update",
      cell: updatedRows[0]
    });

    broadcastWarehouseData();

    res.json({ success: true, cell: updatedRows[0] });
  } catch (err) {
    await connection.rollback();
    console.error("Error /api/cells/:cellId/assign:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// ======== PRODUCTS API ========
app.get("/api/products", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, 
             COUNT(c.id) as occupied_cells,
             SUM(c.quantity) as total_quantity
      FROM products p
      LEFT JOIN cells c ON p.id = c.product_id
      GROUP BY p.id
      ORDER BY p.name
    `);
    res.json(rows);
  } catch (err) {
    console.error("Error /api/products GET:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const { name, sku, rfid_uid, category } = req.body;
    const [result] = await pool.query(
      "INSERT INTO products (name, sku, rfid_uid, category) VALUES (?, ?, ?, ?)",
      [name, sku || null, rfid_uid || null, category || null]
    );
    
    // Get the inserted product
    const [products] = await pool.query(
      "SELECT * FROM products WHERE id = ?",
      [result.insertId]
    );
    
    res.json({ success: true, product: products[0] });
  } catch (err) {
    console.error("Error /api/products POST:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ======== OPERATIONS API ========
app.get("/api/operations", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const [rows] = await pool.query(`
      SELECT o.*,
             c.label AS cell_label,
             p.name AS product_name
      FROM operations o
      LEFT JOIN cells c ON o.cell_id = c.id
      LEFT JOIN products p ON o.product_id = p.id
      ORDER BY o.created_at DESC
      LIMIT ?
    `, [limit]);
    res.json(rows);
  } catch (err) {
    console.error("Error /api/operations GET:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/operations/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT o.*,
             c.label AS cell_label,
             p.name AS product_name
      FROM operations o
      LEFT JOIN cells c ON o.cell_id = c.id
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.id = ?
    `,
      [req.params.id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error("Error /api/operations/:id GET:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/operations", async (req, res) => {
  const connection = await pool.getConnection();
  const startTime = Date.now();
  let operationId = null;

  try {
    const { op_type, cmd, product_id, cell_id, priority = 'MEDIUM' } = req.body;

    await connection.beginTransaction();

    // Create operation record
    const [result] = await connection.query(
      `INSERT INTO operations (op_type, cmd, product_id, cell_id, status, priority) 
       VALUES (?, ?, ?, ?, 'PENDING', ?)`,
      [op_type, cmd, product_id || null, cell_id || null, priority]
    );

    operationId = result.insertId;

    // Update to processing
    await connection.query(
      "UPDATE operations SET status = 'PROCESSING', started_at = NOW() WHERE id = ?",
      [operationId]
    );

    await connection.commit();

    // Broadcast operation update
    broadcast({
      type: "operation_update",
      operation: { 
        id: operationId, 
        status: "PROCESSING",
        op_type,
        cmd
      }
    });

    armState.currentOperation = operationId;

    // Send command to ESP32
    let esp32Resp;
    try {
      esp32Resp = await sendCommandToESP32(cmd);
    } catch (errEsp) {
      const execMs = Date.now() - startTime;
      await pool.query(
        `UPDATE operations 
         SET status = 'ERROR', 
             completed_at = NOW(), 
             execution_time_ms = ?, 
             error_message = ? 
         WHERE id = ?`,
        [execMs, errEsp.message, operationId]
      );

      broadcast({
        type: "operation_update",
        operation: { id: operationId, status: "ERROR" }
      });

      armState.currentOperation = null;
      
      return res.json({
        success: false,
        id: operationId,
        error: errEsp.message
      });
    }

    const execMs = Date.now() - startTime;

    // Update operation as completed
    await pool.query(
      `UPDATE operations 
       SET status = 'COMPLETED', 
           completed_at = NOW(), 
           execution_time_ms = ? 
       WHERE id = ?`,
      [execMs, operationId]
    );

    // Handle specific operation types
    if (op_type === 'PLACE_IN_CELL' && cell_id && product_id) {
      await pool.query(
        `UPDATE cells 
         SET product_id = ?, 
             quantity = 1,
             status = 'OCCUPIED',
             updated_at = NOW()
         WHERE id = ?`,
        [product_id, cell_id]
      );
      
      broadcast({
        type: "cell_update",
        cell: { id: cell_id, product_id, quantity: 1, status: 'OCCUPIED' }
      });
    } 
    else if (op_type === 'TAKE_FROM_CELL' && cell_id) {
      await pool.query(
        `UPDATE cells 
         SET product_id = NULL,
             quantity = 0,
             status = 'EMPTY',
             updated_at = NOW()
         WHERE id = ?`,
        [cell_id]
      );
      
      broadcast({
        type: "cell_update",
        cell: { id: cell_id, product_id: null, quantity: 0, status: 'EMPTY' }
      });
    } 
    else if (op_type === 'MOVE_TO_LOADING' && cell_id && product_id) {
      await pool.query(
        `UPDATE cells 
         SET product_id = NULL,
             quantity = 0,
             status = 'EMPTY',
             updated_at = NOW()
         WHERE id = ?`,
        [cell_id]
      );

      await pool.query(
        `INSERT INTO loading_zone (id, product_id, quantity, updated_at)
         VALUES (1, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE product_id = ?, quantity = 1, updated_at = NOW()`,
        [product_id, product_id]
      );
      
      broadcast({
        type: "cell_update",
        cell: { id: cell_id, product_id: null, quantity: 0, status: 'EMPTY' }
      });
      
      // Update loading zone broadcast
      const [lzRows] = await pool.query(`
        SELECT lz.*, p.name as product_name, p.sku
        FROM loading_zone lz
        LEFT JOIN products p ON lz.product_id = p.id
        WHERE lz.id = 1
      `);
      
      broadcast({
        type: "loading_zone_update",
        data: lzRows[0]
      });
    }

    // Get updated operation data
    const [operationRows] = await pool.query(`
      SELECT o.*,
             c.label AS cell_label,
             p.name AS product_name
      FROM operations o
      LEFT JOIN cells c ON o.cell_id = c.id
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.id = ?
    `, [operationId]);

    broadcast({
      type: "operation_update",
      operation: { id: operationId, status: "COMPLETED" }
    });

    // Broadcast warehouse data updates
    broadcastWarehouseData();

    armState.currentOperation = null;

    res.json({
      success: true,
      id: operationId,
      operation: operationRows[0],
      esp32: esp32Resp
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error /api/operations POST:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  } finally {
    connection.release();
  }
});

// ======== AUTO TASKS API ========
app.get("/api/auto-tasks", async (req, res) => {
  try {
    const status = req.query.status || 'PENDING';
    const [rows] = await pool.query(`
      SELECT t.*,
             c.label as cell_label,
             p.name as product_name,
             p.rfid_uid
      FROM auto_tasks t
      LEFT JOIN cells c ON t.cell_id = c.id
      LEFT JOIN products p ON t.product_id = p.id
      WHERE t.status = ?
      ORDER BY 
        CASE t.priority
          WHEN 'URGENT' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'LOW' THEN 4
          ELSE 5
        END,
        t.created_at
    `, [status]);
    res.json(rows);
  } catch (err) {
    console.error("Error /api/auto-tasks GET:", err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/auto-tasks", async (req, res) => {
  try {
    const { task_type, cell_id, product_id, product_rfid, quantity, priority } = req.body;
    
    const [result] = await pool.query(
      `INSERT INTO auto_tasks (task_type, cell_id, product_id, product_rfid, quantity, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [task_type, cell_id || null, product_id || null, product_rfid || null, quantity || 1, priority || 'MEDIUM']
    );

    // Get the created task
    const [taskRows] = await pool.query(`
      SELECT t.*, c.label as cell_label, p.name as product_name
      FROM auto_tasks t
      LEFT JOIN cells c ON t.cell_id = c.id
      LEFT JOIN products p ON t.product_id = p.id
      WHERE t.id = ?
    `, [result.insertId]);

    broadcast({
      type: "task_update",
      task: taskRows[0]
    });

    // If in auto mode, start processing tasks
    if (armState.mode === 'auto') {
      processNextAutoTask();
    }

    res.json({ success: true, task: taskRows[0] });
  } catch (err) {
    console.error("Error /api/auto-tasks POST:", err);
    res.status(500).json({ error: "Database error" });
  }
});

async function processNextAutoTask() {
  try {
    // Get highest priority pending task
    const [tasks] = await pool.query(`
      SELECT t.*,
             c.label as cell_label,
             p.name as product_name,
             p.rfid_uid
      FROM auto_tasks t
      LEFT JOIN cells c ON t.cell_id = c.id
      LEFT JOIN products p ON t.product_id = p.id
      WHERE t.status = 'PENDING'
      ORDER BY 
        CASE t.priority
          WHEN 'URGENT' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'LOW' THEN 4
          ELSE 5
        END,
        t.created_at
      LIMIT 1
    `);

    if (tasks.length === 0) return;

    const task = tasks[0];
    
    // Update task status
    await pool.query(
      "UPDATE auto_tasks SET status = 'PROCESSING', started_at = NOW() WHERE id = ?",
      [task.id]
    );

    broadcast({
      type: "task_update",
      task: { ...task, status: 'PROCESSING' }
    });

    // Execute task based on type
    let command = '';
    switch (task.task_type) {
      case 'STOCK':
        if (task.product_rfid) {
          command = `AUTO_STOCK:${task.product_rfid}`;
        } else if (task.product_id) {
          const [product] = await pool.query("SELECT * FROM products WHERE id = ?", [task.product_id]);
          if (product.length > 0 && product[0].rfid_uid) {
            command = `AUTO_STOCK:${product[0].rfid_uid}`;
          }
        }
        break;
      case 'RETRIEVE':
        if (task.cell_id) {
          const [cell] = await pool.query("SELECT * FROM cells WHERE id = ?", [task.cell_id]);
          if (cell.length > 0) {
            command = `TAKE ${cell[0].col_num} ${cell[0].row_num}`;
          }
        }
        break;
    }

    if (command) {
      try {
        await sendCommandToESP32(command);
        
        // Update task as completed
        await pool.query(
          "UPDATE auto_tasks SET status = 'COMPLETED', completed_at = NOW() WHERE id = ?",
          [task.id]
        );

        broadcast({
          type: "task_update",
          task: { ...task, status: 'COMPLETED' }
        });

        // Process next task after delay
        setTimeout(processNextAutoTask, 2000);
      } catch (err) {
        // Update task as failed
        await pool.query(
          "UPDATE auto_tasks SET status = 'FAILED', error_message = ? WHERE id = ?",
          [err.message, task.id]
        );

        broadcast({
          type: "task_update",
          task: { ...task, status: 'FAILED', error_message: err.message }
        });
      }
    } else {
      // No command to execute, mark as completed
      await pool.query(
        "UPDATE auto_tasks SET status = 'COMPLETED', completed_at = NOW() WHERE id = ?",
        [task.id]
      );

      broadcast({
        type: "task_update",
        task: { ...task, status: 'COMPLETED' }
      });

      // Process next task
      setTimeout(processNextAutoTask, 1000);
    }
  } catch (err) {
    console.error("Error processing auto task:", err);
  }
}

// ======== MODE API ========
app.post("/api/mode", async (req, res) => {
  try {
    const { mode } = req.body;
    if (!mode || !["manual", "auto"].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode" });
    }

    armState.mode = mode;

    // Send mode command to ESP32
    try {
      await sendCommandToESP32(`MODE ${mode.toUpperCase()}`);
      
      if (mode === 'auto') {
        await sendCommandToESP32("AUTO START");
        // Start processing auto tasks
        setTimeout(processNextAutoTask, 1000);
      } else {
        await sendCommandToESP32("AUTO STOP");
      }
    } catch (errEsp) {
      console.error("Error sending mode to ESP32:", errEsp);
    }

    broadcast({ 
      type: "mode_update", 
      mode,
      armState 
    });

    res.json({ success: true, mode });
  } catch (err) {
    console.error("Error /api/mode:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ======== STATUS API ========
app.get("/api/status", async (req, res) => {
  try {
    const [cellsTotal] = await pool.query("SELECT COUNT(*) AS total FROM cells");
    const [cellsOcc] = await pool.query("SELECT COUNT(*) AS occupied FROM cells WHERE status = 'OCCUPIED'");
    const [prodTotal] = await pool.query("SELECT COUNT(*) AS total FROM products");
    const [opsPending] = await pool.query("SELECT COUNT(*) AS pending FROM operations WHERE status = 'PENDING'");
    const [tasksPending] = await pool.query("SELECT COUNT(*) AS pending FROM auto_tasks WHERE status = 'PENDING'");

    res.json({
      cells: {
        total: cellsTotal[0].total,
        occupied: cellsOcc[0].occupied,
        available: cellsTotal[0].total - cellsOcc[0].occupied
      },
      products: prodTotal[0].total,
      pending_operations: opsPending[0].pending,
      pending_tasks: tasksPending[0].pending,
      arm: armState,
      sensors: currentSensorData,
      esp32: {
        connected: isESP32Connected,
        url: ESP32_BASE_URL
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Error /api/status:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ======== BROADCAST HELPERS ========
async function broadcastWarehouseData() {
  try {
    const [cells] = await pool.query(`
      SELECT 
        c.*,
        p.name AS product_name,
        p.sku,
        p.rfid_uid,
        CASE 
          WHEN c.product_id IS NOT NULL THEN 'OCCUPIED' 
          ELSE 'EMPTY' 
        END AS display_status
      FROM cells c
      LEFT JOIN products p ON c.product_id = p.id
      ORDER BY c.row_num, c.col_num
    `);

    const [loadingZone] = await pool.query(`
      SELECT lz.*, p.name as product_name, p.sku
      FROM loading_zone lz
      LEFT JOIN products p ON lz.product_id = p.id
      WHERE lz.id = 1
    `);

    broadcast({
      type: "warehouse_data",
      cells: cells,
      loadingZone: loadingZone[0] || { id: 1, product_id: null, quantity: 0 },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Error broadcasting warehouse data:", err);
  }
}

// ======== START SERVER ========
const server = app.listen(PORT, async () => {
  await initializeDatabase();
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  
  // Start periodic broadcasts
  setInterval(broadcastWarehouseData, 3000);
});

server.on("upgrade", (request, socket, head) => {
  if (request.url === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await pool.end();
  process.exit(0);
});