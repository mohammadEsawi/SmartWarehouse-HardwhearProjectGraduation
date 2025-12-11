# SmartWarehouse - Hardware Project Graduation

SmartWarehouse-HardwareProjectGraduation is a comprehensive automation system that integrates a robotic arm, conveyor belt, and storage cells with a web-based management interface. The system enables real-time monitoring and control of warehouse operations through a modern dashboard, supporting both manual control and automated task execution.

## Features

### 🗂️ Real-time Warehouse Visualization
- Interactive 3×4 storage grid (12 cells total)
- Live occupancy status updates
- Visual indicators for empty and occupied cells
- Click cells to view product details

### 🦾 Robotic Arm Control (4-DOF)
- **Manual Mode**: Direct control of X, Y, Z axes and gripper
- **Auto Mode**: Automated task execution from queue
- Real-time status monitoring (Idle, Moving, Picking, Placing)
- Smooth position adjustments with sliders

### 🎚️ Conveyor Belt Integration
- **LDR Sensor Monitoring**: Real-time light sensor readings
- **RFID Product Identification**: Automatic product detection and identification
- Adjustable belt speed control
- Live product detection alerts

### 📦 Product Management
- Full inventory tracking system
- SKU-based identification
- RFID tag support
- Location tracking (which cell contains each product)
- Add, update, and delete products

### ⚙️ Auto Mode Operations
- Automated task queue system
- Three operation types:
  - **Stock**: Place products in storage cells
  - **Retrieve**: Remove products from cells
  - **Inventory**: Scan and verify stock
- Task status tracking (Pending, Processing, Completed, Failed)
- Automatic task execution when in Auto Mode

## Technology Stack

- **Backend**: Node.js with Express
- **Real-time Communication**: WebSocket (ws library)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Architecture**: REST API + WebSocket for bidirectional communication

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Setup

1. Clone the repository:
```bash
git clone https://github.com/mohammadEsawi/SmartWarehouse-HardwhearProjectGraduation.git
cd SmartWarehouse-HardwhearProjectGraduation
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. For development with auto-reload:
```bash
npm run dev
```

5. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage Guide

### Getting Started

1. **Add Products**:
   - Fill in Product Name, SKU, and RFID Tag
   - Click "Add Product" button
   - Products appear in the Product Management list

2. **Manual Robot Control**:
   - Select "Manual Mode"
   - Adjust X, Y, Z axes and Gripper using sliders
   - Click "Execute Move" to send commands

3. **Conveyor Belt**:
   - Click "Start" to run the conveyor
   - Adjust speed with the slider
   - Monitor LDR sensor readings and RFID detections

4. **Automated Operations**:
   - Switch to "Auto Mode" for the robot
   - Add tasks to the queue:
     - Select task type (Stock/Retrieve/Inventory)
     - Choose product and cell
     - Click "Add Task"
   - Tasks will execute automatically

### Storage Grid

The 3×4 grid represents 12 storage cells:
- **Empty cells**: White background with "⬜" icon
- **Occupied cells**: Green background with "📦" icon
- Click any cell to see details

## API Endpoints

### Status
- `GET /api/status` - Get complete system status

### Storage Cells
- `GET /api/cells` - Get all cells
- `GET /api/cells/:id` - Get specific cell

### Products
- `GET /api/products` - List all products
- `POST /api/products` - Add new product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Robot Control
- `GET /api/robot` - Get robot status
- `POST /api/robot/move` - Move robot to position
- `POST /api/robot/mode` - Set robot mode (manual/auto)

### Conveyor Belt
- `GET /api/conveyor` - Get conveyor status
- `POST /api/conveyor/control` - Control conveyor (start/stop/speed)

### Tasks
- `GET /api/tasks` - Get task queue
- `POST /api/tasks` - Add new task
- `DELETE /api/tasks/:id` - Remove task

## WebSocket Events

The system uses WebSocket for real-time updates:

### Client ← Server
- `init` - Initial state on connection
- `cells_updated` - Storage grid changed
- `product_added/updated/deleted` - Product changes
- `robot_moved/status/mode` - Robot updates
- `conveyor_status` - Conveyor changes
- `sensor_update` - Sensor readings
- `rfid_read` - RFID tag detected
- `task_added/processing/completed/removed` - Task updates

## Hardware Integration

The current implementation includes simulated hardware behavior. To connect real hardware:

1. Replace the sensor simulation in `server/index.js`
2. Implement hardware communication protocols for:
   - Robotic arm controller (serial/USB)
   - LDR sensor (ADC/GPIO)
   - RFID reader (serial/USB)
   - Conveyor motor controller
3. Update the WebSocket broadcast functions to send real sensor data

## Project Structure

```
SmartWarehouse-HardwhearProjectGraduation/
├── server/
│   └── index.js          # Express server + WebSocket + API
├── public/
│   ├── index.html        # Main web interface
│   ├── css/
│   │   └── style.css     # Styling
│   └── js/
│       └── app.js        # Frontend logic
├── package.json          # Dependencies
└── README.md            # Documentation
```

## Development

### Running in Development Mode
```bash
npm run dev
```
This uses nodemon for automatic server restart on file changes.

### Customization

- **Grid Size**: Modify the cell array initialization in `server/index.js`
- **Sensor Intervals**: Adjust `setInterval` timing in `server/index.js`
- **Styling**: Edit `public/css/style.css`
- **UI Layout**: Modify `public/index.html`

## License

MIT License - feel free to use this project for educational purposes.
