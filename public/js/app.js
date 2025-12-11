// WebSocket connection
let ws = null;
let reconnectInterval = null;

// State
let state = {
  cells: [],
  products: [],
  robotArm: {},
  conveyorBelt: {},
  taskQueue: []
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  setupEventListeners();
  updateCellSelects();
});

// WebSocket Connection
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    updateConnectionStatus(true);
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleWebSocketMessage(message);
  };
  
  ws.onclose = () => {
    console.log('WebSocket disconnected');
    updateConnectionStatus(false);
    
    // Attempt to reconnect
    if (!reconnectInterval) {
      reconnectInterval = setInterval(() => {
        console.log('Attempting to reconnect...');
        connectWebSocket();
      }, 3000);
    }
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function updateConnectionStatus(connected) {
  const indicator = document.getElementById('connection-indicator');
  const text = document.getElementById('connection-text');
  
  if (connected) {
    indicator.classList.add('connected');
    text.textContent = 'Connected';
  } else {
    indicator.classList.remove('connected');
    text.textContent = 'Disconnected';
  }
}

function handleWebSocketMessage(message) {
  console.log('Received:', message);
  
  switch (message.type) {
    case 'init':
      state = message.data;
      renderAll();
      break;
    case 'cells_updated':
      state.cells = message.data;
      renderGrid();
      break;
    case 'product_added':
      state.products.push(message.data);
      renderProducts();
      updateProductSelect();
      break;
    case 'product_updated':
      const pIdx = state.products.findIndex(p => p.id === message.data.id);
      if (pIdx !== -1) {
        state.products[pIdx] = message.data;
        renderProducts();
      }
      break;
    case 'product_deleted':
      state.products = state.products.filter(p => p.id !== message.data.id);
      renderProducts();
      updateProductSelect();
      break;
    case 'robot_moved':
    case 'robot_status':
    case 'robot_mode':
      state.robotArm = message.data;
      updateRobotStatus();
      break;
    case 'conveyor_status':
      state.conveyorBelt = message.data;
      updateConveyorStatus();
      break;
    case 'sensor_update':
      if (message.data.ldrSensor) {
        updateLDRSensor(message.data.ldrSensor);
      }
      break;
    case 'rfid_read':
      updateRFIDReader(message.data);
      break;
    case 'task_added':
      state.taskQueue.push(message.data);
      renderTasks();
      break;
    case 'task_processing':
    case 'task_completed':
      const tIdx = state.taskQueue.findIndex(t => t.id === message.data.id);
      if (tIdx !== -1) {
        state.taskQueue[tIdx] = message.data;
        renderTasks();
      }
      break;
    case 'task_removed':
      state.taskQueue = state.taskQueue.filter(t => t.id !== message.data.id);
      renderTasks();
      break;
  }
}

// Render functions
function renderAll() {
  renderGrid();
  renderProducts();
  renderTasks();
  updateRobotStatus();
  updateConveyorStatus();
  updateProductSelect();
  updateCellSelects();
}

function renderGrid() {
  const grid = document.getElementById('storage-grid');
  grid.innerHTML = '';
  
  state.cells.forEach(cell => {
    const cellDiv = document.createElement('div');
    cellDiv.className = `cell ${cell.occupied ? 'occupied' : 'empty'}`;
    cellDiv.innerHTML = `
      <div class="cell-id">Cell ${cell.id}</div>
      <div class="cell-status">${cell.occupied ? '📦' : '⬜'}</div>
    `;
    
    cellDiv.addEventListener('click', () => {
      showCellInfo(cell);
    });
    
    grid.appendChild(cellDiv);
  });
}

function showCellInfo(cell) {
  if (cell.occupied && cell.productId) {
    const product = state.products.find(p => p.id === cell.productId);
    if (product) {
      alert(`Cell ${cell.id}\nProduct: ${product.name}\nSKU: ${product.sku}\nRFID: ${product.rfid}`);
    }
  } else {
    alert(`Cell ${cell.id}\nStatus: Empty`);
  }
}

function renderProducts() {
  const list = document.getElementById('products-list');
  list.innerHTML = '';
  
  if (state.products.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 20px;">No products added yet</p>';
    return;
  }
  
  state.products.forEach(product => {
    const item = document.createElement('div');
    item.className = 'product-item';
    
    const cellInfo = product.cellId !== null ? `Cell ${product.cellId}` : 'Not stored';
    
    item.innerHTML = `
      <div class="product-info">
        <div class="product-name">${product.name}</div>
        <div class="product-details">
          <span>SKU: ${product.sku}</span>
          <span>RFID: ${product.rfid}</span>
          <span>Location: ${cellInfo}</span>
        </div>
      </div>
      <div class="product-actions">
        <button class="btn btn-danger btn-small" onclick="deleteProduct(${product.id})">Delete</button>
      </div>
    `;
    
    list.appendChild(item);
  });
}

function renderTasks() {
  const list = document.getElementById('tasks-list');
  list.innerHTML = '';
  
  if (state.taskQueue.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 20px;">No tasks in queue</p>';
    return;
  }
  
  state.taskQueue.forEach(task => {
    const item = document.createElement('div');
    item.className = 'task-item';
    
    let statusBadge = '';
    if (task.status === 'pending') {
      statusBadge = '<span class="badge badge-warning">Pending</span>';
    } else if (task.status === 'processing') {
      statusBadge = '<span class="badge badge-info">Processing</span>';
    } else if (task.status === 'completed') {
      statusBadge = '<span class="badge badge-success">Completed</span>';
    } else if (task.status === 'failed') {
      statusBadge = '<span class="badge badge-danger">Failed</span>';
    }
    
    const product = state.products.find(p => p.id === task.productId);
    const productName = product ? product.name : 'N/A';
    const cellInfo = task.cellId !== null ? `Cell ${task.cellId}` : 'N/A';
    
    item.innerHTML = `
      <div class="task-info">
        <div class="task-type">${task.type} ${statusBadge}</div>
        <div class="task-details">
          Product: ${productName} | Cell: ${cellInfo}
        </div>
      </div>
      <div class="product-actions">
        <button class="btn btn-danger btn-small" onclick="deleteTask(${task.id})" ${task.status === 'processing' ? 'disabled' : ''}>Remove</button>
      </div>
    `;
    
    list.appendChild(item);
  });
}

function updateRobotStatus() {
  const statusEl = document.getElementById('robot-status');
  if (state.robotArm.status) {
    statusEl.textContent = state.robotArm.status.charAt(0).toUpperCase() + state.robotArm.status.slice(1);
  }
  
  // Update mode radio buttons
  const modeRadios = document.querySelectorAll('input[name="robot-mode"]');
  modeRadios.forEach(radio => {
    radio.checked = radio.value === state.robotArm.mode;
  });
  
  // Update position displays
  if (state.robotArm.position) {
    document.getElementById('x-value').textContent = state.robotArm.position.x;
    document.getElementById('y-value').textContent = state.robotArm.position.y;
    document.getElementById('z-value').textContent = state.robotArm.position.z;
    document.getElementById('gripper-value').textContent = state.robotArm.position.gripper;
    
    document.getElementById('x-control').value = state.robotArm.position.x;
    document.getElementById('y-control').value = state.robotArm.position.y;
    document.getElementById('z-control').value = state.robotArm.position.z;
    document.getElementById('gripper-control').value = state.robotArm.position.gripper;
  }
}

function updateConveyorStatus() {
  const statusEl = document.getElementById('conveyor-status');
  statusEl.textContent = state.conveyorBelt.running ? 'Running' : 'Stopped';
  statusEl.className = state.conveyorBelt.running ? 'badge badge-success' : 'badge badge-danger';
  
  document.getElementById('conveyor-speed').textContent = state.conveyorBelt.speed;
  document.getElementById('speed-control').value = state.conveyorBelt.speed;
  document.getElementById('speed-value').textContent = state.conveyorBelt.speed;
}

function updateLDRSensor(ldrData) {
  document.getElementById('ldr-value').textContent = Math.round(ldrData.value);
  
  const detectedEl = document.getElementById('product-detected');
  if (ldrData.productDetected) {
    detectedEl.textContent = 'Product Detected!';
    detectedEl.className = 'badge badge-success';
  } else {
    detectedEl.textContent = 'No Product';
    detectedEl.className = 'badge';
  }
}

function updateRFIDReader(rfidData) {
  document.getElementById('rfid-last').textContent = rfidData.lastRead || 'None';
  
  const productEl = document.getElementById('rfid-product');
  if (rfidData.currentProduct) {
    productEl.textContent = rfidData.currentProduct.name;
  } else {
    productEl.textContent = rfidData.lastRead ? 'Unknown' : 'None';
  }
}

function updateProductSelect() {
  const select = document.getElementById('task-product');
  const currentValue = select.value;
  
  select.innerHTML = '<option value="">Select Product</option>';
  
  state.products.forEach(product => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} (${product.sku})`;
    select.appendChild(option);
  });
  
  if (currentValue) {
    select.value = currentValue;
  }
}

function updateCellSelects() {
  const select = document.getElementById('task-cell');
  const currentValue = select.value;
  
  select.innerHTML = '<option value="">Select Cell</option>';
  
  for (let i = 0; i < 12; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = `Cell ${i}`;
    select.appendChild(option);
  }
  
  if (currentValue) {
    select.value = currentValue;
  }
}

// Event Listeners
function setupEventListeners() {
  // Robot controls
  document.getElementById('x-control').addEventListener('input', (e) => {
    document.getElementById('x-value').textContent = e.target.value;
  });
  
  document.getElementById('y-control').addEventListener('input', (e) => {
    document.getElementById('y-value').textContent = e.target.value;
  });
  
  document.getElementById('z-control').addEventListener('input', (e) => {
    document.getElementById('z-value').textContent = e.target.value;
  });
  
  document.getElementById('gripper-control').addEventListener('input', (e) => {
    document.getElementById('gripper-value').textContent = e.target.value;
  });
  
  document.getElementById('move-robot-btn').addEventListener('click', moveRobot);
  
  document.querySelectorAll('input[name="robot-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      setRobotMode(e.target.value);
    });
  });
  
  // Conveyor controls
  document.getElementById('speed-control').addEventListener('input', (e) => {
    document.getElementById('speed-value').textContent = e.target.value;
  });
  
  document.getElementById('start-conveyor-btn').addEventListener('click', () => {
    controlConveyor(true, parseInt(document.getElementById('speed-control').value));
  });
  
  document.getElementById('stop-conveyor-btn').addEventListener('click', () => {
    controlConveyor(false, 0);
  });
  
  // Product management
  document.getElementById('add-product-btn').addEventListener('click', addProduct);
  
  // Task management
  document.getElementById('add-task-btn').addEventListener('click', addTask);
}

// API Functions
async function moveRobot() {
  const x = parseInt(document.getElementById('x-control').value);
  const y = parseInt(document.getElementById('y-control').value);
  const z = parseInt(document.getElementById('z-control').value);
  const gripper = parseInt(document.getElementById('gripper-control').value);
  
  try {
    const response = await fetch('/api/robot/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, z, gripper })
    });
    
    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Failed to move robot');
    }
  } catch (error) {
    console.error('Error moving robot:', error);
    alert('Failed to move robot');
  }
}

async function setRobotMode(mode) {
  try {
    await fetch('/api/robot/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
  } catch (error) {
    console.error('Error setting robot mode:', error);
  }
}

async function controlConveyor(running, speed) {
  try {
    await fetch('/api/conveyor/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ running, speed })
    });
  } catch (error) {
    console.error('Error controlling conveyor:', error);
  }
}

async function addProduct() {
  const name = document.getElementById('product-name').value.trim();
  const sku = document.getElementById('product-sku').value.trim();
  const rfid = document.getElementById('product-rfid').value.trim();
  
  if (!name || !sku || !rfid) {
    alert('Please fill in all product fields');
    return;
  }
  
  try {
    const response = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sku, rfid })
    });
    
    if (response.ok) {
      document.getElementById('product-name').value = '';
      document.getElementById('product-sku').value = '';
      document.getElementById('product-rfid').value = '';
    }
  } catch (error) {
    console.error('Error adding product:', error);
    alert('Failed to add product');
  }
}

async function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this product?')) {
    return;
  }
  
  try {
    await fetch(`/api/products/${id}`, { method: 'DELETE' });
  } catch (error) {
    console.error('Error deleting product:', error);
    alert('Failed to delete product');
  }
}

async function addTask() {
  const type = document.getElementById('task-type').value;
  const productId = parseInt(document.getElementById('task-product').value);
  const cellId = parseInt(document.getElementById('task-cell').value);
  
  if (type === 'stock' && (!productId || isNaN(cellId))) {
    alert('Please select a product and cell for stocking');
    return;
  }
  
  if (type === 'retrieve' && isNaN(cellId)) {
    alert('Please select a cell for retrieval');
    return;
  }
  
  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        productId: productId || null,
        cellId: isNaN(cellId) ? null : cellId
      })
    });
    
    if (response.ok) {
      document.getElementById('task-product').value = '';
      document.getElementById('task-cell').value = '';
    }
  } catch (error) {
    console.error('Error adding task:', error);
    alert('Failed to add task');
  }
}

async function deleteTask(id) {
  try {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  } catch (error) {
    console.error('Error deleting task:', error);
    alert('Failed to delete task');
  }
}
