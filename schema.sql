-- Enhanced Database Schema for Smart Warehouse - FIXED VERSION
DROP DATABASE IF EXISTS smart_warehouse;
CREATE DATABASE IF NOT EXISTS smart_warehouse
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE smart_warehouse;

-- Admin user
CREATE TABLE admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cells (3 rows x 4 columns)
CREATE TABLE cells (
    id INT AUTO_INCREMENT PRIMARY KEY,
    row_num INT NOT NULL CHECK (row_num BETWEEN 1 AND 3),
    col_num INT NOT NULL CHECK (col_num BETWEEN 1 AND 4),
    label VARCHAR(50) NOT NULL,
    status ENUM('EMPTY', 'OCCUPIED', 'RESERVED') DEFAULT 'EMPTY',
    product_id INT NULL,
    quantity INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (row_num, col_num),
    INDEX idx_status (status),
    INDEX idx_product (product_id)
);

-- Products
CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sku VARCHAR(100) NULL,
    rfid_uid VARCHAR(100) UNIQUE NULL,
    weight_grams INT NULL,
    category VARCHAR(50) NULL,
    auto_assign BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sku (sku),
    INDEX idx_rfid (rfid_uid)
);

-- Operations with improved tracking
CREATE TABLE operations (
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
        'AUTO_RETRIEVE',
        'INVENTORY_CHECK'
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
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    FOREIGN KEY (cell_id) REFERENCES cells(id) ON DELETE SET NULL,
    INDEX idx_status (status),
    INDEX idx_op_type (op_type),
    INDEX idx_priority (priority)
);

-- Loading Zone
CREATE TABLE loading_zone (
    id INT PRIMARY KEY DEFAULT 1,
    product_id INT NULL,
    quantity INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- Auto Task Queue with priority
CREATE TABLE auto_tasks (
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (cell_id) REFERENCES cells(id) ON DELETE SET NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    INDEX idx_task_status (status),
    INDEX idx_priority_scheduled (priority, scheduled_at)
);

-- Conveyor belt status
CREATE TABLE conveyor_status (
    id INT PRIMARY KEY DEFAULT 1,
    has_product BOOLEAN DEFAULT FALSE,
    product_id INT NULL,
    product_rfid VARCHAR(100) NULL,
    last_detected_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- Sensor events
CREATE TABLE sensor_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source ENUM('LDR1', 'LDR2', 'RFID', 'ULTRASONIC', 'LIMIT_SWITCH') NOT NULL,
    value VARCHAR(100) NOT NULL,
    unit VARCHAR(20) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_source_created (source, created_at)
);

-- Initialize data
INSERT INTO admins (username, password_hash) 
VALUES ('admin', '$2y$10$exampleexampleexampleexampleexampleexampleex');

-- Initialize cells (3 rows x 4 columns)
INSERT INTO cells (row_num, col_num, label) VALUES
(1,1,'R1C1'), (1,2,'R1C2'), (1,3,'R1C3'), (1,4,'R1C4'),
(2,1,'R2C1'), (2,2,'R2C2'), (2,3,'R2C3'), (2,4,'R2C4'),
(3,1,'R3C1'), (3,2,'R3C2'), (3,3,'R3C3'), (3,4,'R3C4');

-- Initialize loading zone
INSERT INTO loading_zone (id, product_id, quantity) VALUES (1, NULL, 0);

-- Initialize conveyor status
INSERT INTO conveyor_status (id, has_product, product_id) VALUES (1, FALSE, NULL);

-- Sample products
INSERT INTO products (name, sku, rfid_uid, category) VALUES
('Product A', 'PROD-A-001', '12.80.110.3', 'Electronics'),
('Product B', 'PROD-B-001', '178.139.221.208', 'Tools'),
('Product C', 'PROD-C-001', '204.187.101.3', 'Components'),
('Product D', 'PROD-D-001', '12.86.101.3', 'Materials');

-- Create helpful views
CREATE VIEW warehouse_current_status AS
SELECT 
    c.id,
    c.label,
    c.row_num,
    c.col_num,
    c.status,
    c.product_id,
    p.name as product_name,
    p.sku,
    c.quantity,
    p.rfid_uid,
    c.updated_at
FROM cells c
LEFT JOIN products p ON c.product_id = p.id
ORDER BY c.row_num, c.col_num;

CREATE VIEW auto_task_queue AS
SELECT 
    t.*,
    c.label as cell_label,
    p.name as product_name,
    p.rfid_uid,
    CASE 
        WHEN t.status = 'PENDING' AND t.priority = 'URGENT' THEN 1
        WHEN t.status = 'PENDING' AND t.priority = 'HIGH' THEN 2
        WHEN t.status = 'PENDING' AND t.priority = 'MEDIUM' THEN 3
        WHEN t.status = 'PENDING' AND t.priority = 'LOW' THEN 4
        ELSE 5
    END as execution_order
FROM auto_tasks t
LEFT JOIN cells c ON t.cell_id = c.id
LEFT JOIN products p ON t.product_id = p.id
WHERE t.status IN ('PENDING', 'PROCESSING')
ORDER BY execution_order, t.created_at;

-- Stored procedure for auto stock
DELIMITER //
CREATE PROCEDURE ProcessAutoStock(IN rfid_tag VARCHAR(100))
BEGIN
    DECLARE productId INT;
    DECLARE emptyCellId INT;
    
    -- Find product by RFID
    SELECT id INTO productId FROM products WHERE rfid_uid = rfid_tag LIMIT 1;
    
    IF productId IS NOT NULL THEN
        -- Find first empty cell
        SELECT id INTO emptyCellId 
        FROM cells 
        WHERE status = 'EMPTY' 
        ORDER BY row_num, col_num 
        LIMIT 1;
        
        IF emptyCellId IS NOT NULL THEN
            -- Update cell status
            UPDATE cells 
            SET status = 'OCCUPIED', 
                product_id = productId, 
                quantity = 1,
                updated_at = NOW()
            WHERE id = emptyCellId;
            
            -- Update conveyor status
            UPDATE conveyor_status 
            SET has_product = FALSE, 
                product_id = NULL,
                product_rfid = NULL,
                updated_at = NOW()
            WHERE id = 1;
            
            -- Log operation
            INSERT INTO operations (op_type, cmd, product_id, cell_id, status)
            VALUES ('AUTO_STOCK', CONCAT('AUTO_STOCK:', rfid_tag), productId, emptyCellId, 'COMPLETED');
            
            SELECT CONCAT('SUCCESS: Product stocked in cell ', emptyCellId) as result;
        ELSE
            SELECT 'ERROR: No empty cells available' as result;
        END IF;
    ELSE
        SELECT 'ERROR: Product not found for RFID' as result;
    END IF;
END//

CREATE PROCEDURE AddAutoTask(
    IN taskType ENUM('STOCK', 'RETRIEVE', 'MOVE', 'ORGANIZE', 'INVENTORY_CHECK'),
    IN taskCellId INT,
    IN taskProductId INT,
    IN taskRfid VARCHAR(100),
    IN taskPriority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
    IN taskQty INT
)
BEGIN
    INSERT INTO auto_tasks (
        task_type, 
        cell_id, 
        product_id, 
        product_rfid,
        quantity, 
        priority, 
        status
    ) VALUES (
        taskType,
        taskCellId,
        taskProductId,
        taskRfid,
        COALESCE(taskQty, 1),
        taskPriority,
        'PENDING'
    );
    
    SELECT LAST_INSERT_ID() as task_id;
END//
DELIMITER ;