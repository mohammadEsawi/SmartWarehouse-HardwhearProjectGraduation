const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const WebSocket = require('ws');
const path = require('path');

// Configuration constants
const SENSOR_UPDATE_INTERVAL = 1000;
const PRODUCT_DETECTION_THRESHOLD = 0.9;
const TASK_EXECUTION_TIME = 5000;
const TASK_COMPLETION_DELAY = 1000;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// In-memory storage (replace with database in production)
const storage = {
  // 3x4 grid (12 cells total)
  cells: Array(12).fill(null).map((_, index) => ({
    id: index,
    row: Math.floor(index / 4),
    col: index % 4,
    occupied: false,
    productId: null
  })),
  
  products: [],
  
  robotArm: {
    position: { x: 0, y: 0, z: 0, gripper: 0 },
    status: 'idle', // idle, moving, picking, placing
    mode: 'manual' // manual, auto
  },
  
  conveyorBelt: {
    running: false,
    speed: 0,
    ldrSensor: { value: 0, productDetected: false },
    rfidReader: { lastRead: null, currentProduct: null }
  },
  
  taskQueue: []
};

// WebSocket Server
const server = app.listen(PORT, () => {
  console.log(`Smart Warehouse Server running on http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

// Broadcast to all connected clients
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  // Send initial state
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      cells: storage.cells,
      products: storage.products,
      robotArm: storage.robotArm,
      conveyorBelt: storage.conveyorBelt,
      taskQueue: storage.taskQueue
    }
  }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(data);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

function handleWebSocketMessage(data) {
  // Handle real-time commands from clients
  console.log('Received message:', data);
}

// REST API Endpoints

// Get warehouse status
app.get('/api/status', (req, res) => {
  res.json({
    cells: storage.cells,
    products: storage.products,
    robotArm: storage.robotArm,
    conveyorBelt: storage.conveyorBelt,
    taskQueue: storage.taskQueue
  });
});

// Storage Cells
app.get('/api/cells', (req, res) => {
  res.json(storage.cells);
});

app.get('/api/cells/:id', (req, res) => {
  const cell = storage.cells.find(c => c.id === parseInt(req.params.id));
  if (cell) {
    res.json(cell);
  } else {
    res.status(404).json({ error: 'Cell not found' });
  }
});

// Products
app.get('/api/products', (req, res) => {
  res.json(storage.products);
});

app.post('/api/products', (req, res) => {
  const { name, sku, rfid } = req.body;
  const product = {
    id: Date.now() + Math.random(), // Simple collision avoidance
    name,
    sku,
    rfid,
    cellId: null,
    createdAt: new Date().toISOString()
  };
  storage.products.push(product);
  
  broadcast({
    type: 'product_added',
    data: product
  });
  
  res.status(201).json(product);
});

app.put('/api/products/:id', (req, res) => {
  const product = storage.products.find(p => p.id === parseInt(req.params.id));
  if (product) {
    Object.assign(product, req.body);
    broadcast({
      type: 'product_updated',
      data: product
    });
    res.json(product);
  } else {
    res.status(404).json({ error: 'Product not found' });
  }
});

app.delete('/api/products/:id', (req, res) => {
  const index = storage.products.findIndex(p => p.id === parseInt(req.params.id));
  if (index !== -1) {
    const product = storage.products.splice(index, 1)[0];
    broadcast({
      type: 'product_deleted',
      data: { id: product.id }
    });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Product not found' });
  }
});

// Robotic Arm Control
app.get('/api/robot', (req, res) => {
  res.json(storage.robotArm);
});

app.post('/api/robot/move', (req, res) => {
  const { x, y, z, gripper } = req.body;
  
  if (storage.robotArm.mode === 'auto' && storage.robotArm.status !== 'idle') {
    return res.status(400).json({ error: 'Robot is in auto mode and busy' });
  }
  
  storage.robotArm.position = { x, y, z, gripper };
  storage.robotArm.status = 'moving';
  
  broadcast({
    type: 'robot_moved',
    data: storage.robotArm
  });
  
  // Simulate movement completion
  setTimeout(() => {
    storage.robotArm.status = 'idle';
    broadcast({
      type: 'robot_status',
      data: storage.robotArm
    });
  }, 2000);
  
  res.json(storage.robotArm);
});

app.post('/api/robot/mode', (req, res) => {
  const { mode } = req.body;
  if (typeof mode !== 'string' || !['manual', 'auto'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  
  storage.robotArm.mode = mode;
  broadcast({
    type: 'robot_mode',
    data: { mode }
  });
  
  res.json({ mode });
});

// Conveyor Belt
app.get('/api/conveyor', (req, res) => {
  res.json(storage.conveyorBelt);
});

app.post('/api/conveyor/control', (req, res) => {
  const { running, speed } = req.body;
  
  if (running !== undefined) {
    storage.conveyorBelt.running = running;
  }
  if (speed !== undefined) {
    storage.conveyorBelt.speed = Math.max(0, Math.min(100, speed));
  }
  
  broadcast({
    type: 'conveyor_status',
    data: storage.conveyorBelt
  });
  
  res.json(storage.conveyorBelt);
});

// Task Queue
app.get('/api/tasks', (req, res) => {
  res.json(storage.taskQueue);
});

app.post('/api/tasks', (req, res) => {
  const { type, productId, cellId } = req.body;
  const task = {
    id: Date.now(),
    type, // 'stock', 'retrieve', 'inventory'
    productId,
    cellId,
    status: 'pending', // pending, processing, completed, failed
    createdAt: new Date().toISOString()
  };
  
  storage.taskQueue.push(task);
  
  broadcast({
    type: 'task_added',
    data: task
  });
  
  // Auto-execute if in auto mode
  if (storage.robotArm.mode === 'auto') {
    processNextTask();
  }
  
  res.status(201).json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const index = storage.taskQueue.findIndex(t => t.id === parseInt(req.params.id));
  if (index !== -1) {
    storage.taskQueue.splice(index, 1);
    broadcast({
      type: 'task_removed',
      data: { id: parseInt(req.params.id) }
    });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

// Process tasks automatically
function processNextTask() {
  const task = storage.taskQueue.find(t => t.status === 'pending');
  if (!task || storage.robotArm.status !== 'idle') return;
  
  task.status = 'processing';
  broadcast({
    type: 'task_processing',
    data: task
  });
  
  // Simulate task execution
  setTimeout(() => {
    if (task.type === 'stock' && task.productId && task.cellId !== null) {
      const cell = storage.cells.find(c => c.id === task.cellId);
      const product = storage.products.find(p => p.id === task.productId);
      
      if (cell && product && !cell.occupied) {
        cell.occupied = true;
        cell.productId = task.productId;
        product.cellId = task.cellId;
        task.status = 'completed';
      } else {
        task.status = 'failed';
      }
    } else if (task.type === 'retrieve' && task.cellId !== null) {
      const cell = storage.cells.find(c => c.id === task.cellId);
      
      if (cell && cell.occupied) {
        const product = storage.products.find(p => p.id === cell.productId);
        if (product) {
          product.cellId = null;
        }
        cell.occupied = false;
        cell.productId = null;
        task.status = 'completed';
      } else {
        task.status = 'failed';
      }
    } else if (task.type === 'inventory') {
      task.status = 'completed';
    }
    
    broadcast({
      type: 'task_completed',
      data: task
    });
    
    broadcast({
      type: 'cells_updated',
      data: storage.cells
    });
    
    // Process next task
    if (storage.robotArm.mode === 'auto') {
      setTimeout(() => processNextTask(), TASK_COMPLETION_DELAY);
    }
  }, TASK_EXECUTION_TIME);
}

// Simulate sensor readings
setInterval(() => {
  // Simulate LDR sensor readings
  storage.conveyorBelt.ldrSensor.value = Math.random() * 1023;
  
  // Simulate product detection on conveyor
  if (storage.conveyorBelt.running && Math.random() > PRODUCT_DETECTION_THRESHOLD) {
    storage.conveyorBelt.ldrSensor.productDetected = true;
    
    // Simulate RFID reading
    setTimeout(() => {
      const rfidTags = ['RF001', 'RF002', 'RF003', 'RF004', 'RF005'];
      storage.conveyorBelt.rfidReader.lastRead = rfidTags[Math.floor(Math.random() * rfidTags.length)];
      storage.conveyorBelt.rfidReader.currentProduct = storage.products.find(
        p => p.rfid === storage.conveyorBelt.rfidReader.lastRead
      ) || null;
      
      broadcast({
        type: 'rfid_read',
        data: storage.conveyorBelt.rfidReader
      });
      
      setTimeout(() => {
        storage.conveyorBelt.ldrSensor.productDetected = false;
      }, 3000);
    }, 500);
  }
  
  broadcast({
    type: 'sensor_update',
    data: {
      ldrSensor: storage.conveyorBelt.ldrSensor
    }
  });
}, SENSOR_UPDATE_INTERVAL);
