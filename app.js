// FILE: app.js - COMPLETE FIXED VERSION
const API_BASE = window.location.origin;
const WS_URL = API_BASE.replace("http", "ws") + "/ws";

const state = {
  mode: "manual",
  cells: [],
  products: [],
  operations: [],
  autoTasks: [],
  loadingZone: null,
  conveyorProduct: null,
  isConnected: false,
  esp32Connected: false,
  currentOperation: null,
  isLoading: false,
  autoModeRunning: false,
  sensorData: {
    ldr1: false,
    ldr2: false,
    rfid: null,
    conveyorState: "IDLE"
  }
};

let ws = null;
let reconnectTimeout = null;

const elements = {
  modeSelect: document.getElementById("mode-select"),
  manualControls: document.getElementById("manual-controls"),
  autoControls: document.getElementById("auto-controls"),
  modeStatus: document.getElementById("mode-status"),
  loadingOverlay: document.getElementById("loading-overlay"),
  loadingTitle: document.getElementById("loading-title"),
  loadingMessage: document.getElementById("loading-message"),
  progressBar: document.getElementById("progress-bar"),
  currentStep: document.getElementById("current-step"),
  estimatedTime: document.getElementById("estimated-time"),
  cellsGrid: document.getElementById("cells-grid"),
  loadingZone: document.getElementById("loading-zone-content"),
  conveyorProduct: document.getElementById("conveyor-product"),
  taskQueue: document.getElementById("task-queue"),
  taskModal: document.getElementById("task-modal"),
  ldr1Indicator: document.getElementById("ldr1-indicator"),
  ldr2Indicator: document.getElementById("ldr2-indicator"),
  conveyorStatus: document.getElementById("conveyor-status"),
  rfidTag: document.getElementById("rfid-tag"),
  autoConveyorState: document.getElementById("auto-conveyor-state"),
  currentRfid: document.getElementById("current-rfid"),
  targetCell: document.getElementById("target-cell"),
  conveyor: document.getElementById("conveyor"),
  esp32Status: document.getElementById("esp32-status"),
  armStatus: document.getElementById("arm-status"),
  totalCells: document.getElementById("total-cells"),
  occupiedCells: document.getElementById("occupied-cells"),
  availableCells: document.getElementById("available-cells"),
  loadingStatus: document.getElementById("loading-status")
};

// ========== WEBSOCKET CONNECTION ==========
function connectWebSocket() {
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("WebSocket connected");
      state.isConnected = true;
      updateConnectionStatus(true);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };

    ws.onmessage = (event) => {
      try {
        if (!event.data || (event.data[0] !== "{" && event.data[0] !== "[")) {
          console.warn("Non-JSON WS message:", event.data);
          return;
        }
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      state.isConnected = false;
      updateConnectionStatus(false);
      reconnectTimeout = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  } catch (error) {
    console.error("Failed to connect WebSocket:", error);
  }
}

// ========== MODE MANAGEMENT ==========
function applyModeUI(mode) {
  state.mode = mode;
  elements.modeSelect.value = mode;
  elements.modeStatus.textContent =
    mode.charAt(0).toUpperCase() + mode.slice(1) + " Mode";

  if (mode === "manual") {
    elements.manualControls.style.display = "block";
    elements.autoControls.style.display = "none";
    elements.modeStatus.className = "badge badge-blue";
  } else {
    elements.manualControls.style.display = "none";
    elements.autoControls.style.display = "block";
    elements.modeStatus.className = "badge badge-yellow";
  }
}

// ========== WEBSOCKET MESSAGE HANDLER ==========
function handleWebSocketMessage(data) {
  switch (data.type) {
    case "init":
      if (data.armState) {
        if (data.armState.mode) {
          applyModeUI(data.armState.mode);
        }
        if (data.armState.status) {
          updateArmStatus(data.armState.status);
        }
      }
      if (data.sensorData) {
        updateSensors(data.sensorData);
      }
      if (data.esp32Connected !== undefined) {
        updateESP32Status(data.esp32Connected);
      }
      break;
      
    case "mode_update":
      applyModeUI(data.mode);
      break;
      
    case "operation_update":
      updateOperationStatus(data.operation);
      break;
      
    case "warehouse_data":
      if (data.cells) {
        state.cells = data.cells;
        renderCells();
        updateStats();
      }
      if (data.loadingZone) {
        state.loadingZone = data.loadingZone;
        renderLoadingZone();
      }
      break;
      
    case "cell_update":
      updateCell(data.cell);
      break;
      
    case "sensor_update":
      updateSensors(data.data);
      break;
      
    case "rfid_detected":
      updateRFID(data.tag, data.symbol, data.product, data.targetCell);
      break;
      
    case "esp32_status":
      updateESP32Status(data.connected);
      break;
      
    case "task_update":
      updateAutoTask(data.task);
      break;
      
    case "conveyor_update":
      updateConveyor(data.product);
      break;
      
    case "loading_zone_update":
      state.loadingZone = data.data;
      renderLoadingZone();
      break;
      
    default:
      console.log("Unknown WS message:", data);
  }
}

// ========== API CALLS ==========
async function apiCall(endpoint, method = "GET", data = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" }
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API ${endpoint} failed:`, error.message);
    throw error;
  }
}

// ========== LOADING OVERLAY ==========
function showLoading(title, message, estimatedTime = 5) {
  state.isLoading = true;
  elements.loadingTitle.textContent = title;
  elements.loadingMessage.textContent = message;
  elements.estimatedTime.textContent = `${estimatedTime}s`;
  elements.progressBar.style.width = "0%";
  elements.loadingOverlay.classList.add("active");

  let progress = 0;
  const interval = setInterval(() => {
    progress += 100 / (estimatedTime * 10);
    if (progress >= 100) {
      clearInterval(interval);
      progress = 100;
    }
    elements.progressBar.style.width = `${progress}%`;
  }, 100);

  return () => {
    clearInterval(interval);
    hideLoading();
  };
}

function hideLoading() {
  state.isLoading = false;
  elements.loadingOverlay.classList.remove("active");
  setTimeout(() => {
    elements.progressBar.style.width = "0%";
  }, 300);
}

// ========== STATUS UPDATES ==========
function updateConnectionStatus(connected) {
  if (connected) {
    elements.esp32Status.textContent = "ESP32: Connected (WS)";
    elements.esp32Status.className = "badge badge-green";
  } else {
    elements.esp32Status.textContent = "ESP32: Disconnected";
    elements.esp32Status.className = "badge badge-red";
  }
}

function updateESP32Status(connected) {
  state.esp32Connected = connected;
  if (connected) {
    elements.esp32Status.textContent = "ESP32: Connected";
    elements.esp32Status.className = "badge badge-green";
  } else {
    elements.esp32Status.textContent = "ESP32: Disconnected";
    elements.esp32Status.className = "badge badge-red";
  }
}

function updateArmStatus(status) {
  elements.armStatus.textContent = `Arm: ${status}`;

  if (status.includes("Ready") || status.includes("Idle") || status.includes("COMPLETE")) {
    elements.armStatus.className = "badge badge-green";
  } else if (status.includes("Moving") || status.includes("Busy") || status.includes("HOMING") || status.includes("PROCESSING")) {
    elements.armStatus.className = "badge badge-yellow";
  } else if (status.includes("Error")) {
    elements.armStatus.className = "badge badge-red";
  } else {
    elements.armStatus.className = "badge badge-gray";
  }
}

// ========== DATA LOADING ==========
async function loadWarehouseData() {
  try {
    const requests = [
      apiCall("/api/cells"),
      apiCall("/api/products"),
      apiCall("/api/operations?limit=20"),
      apiCall("/api/loading-zone").catch(err => {
        console.warn("Loading zone endpoint:", err.message);
        return { id: 1, product_id: null, quantity: 0 };
      }),
      apiCall("/api/conveyor-status").catch(err => {
        console.warn("Conveyor status endpoint:", err.message);
        return { id: 1, has_product: false, product_id: null };
      }),
      apiCall("/api/auto-tasks?status=PENDING").catch(err => {
        console.warn("Auto tasks endpoint:", err.message);
        return [];
      })
    ];

    const [
      cellsData,
      productsData,
      operationsData,
      loadingZoneData,
      conveyorData,
      autoTasksData
    ] = await Promise.all(requests);

    state.cells = cellsData;
    state.products = productsData;
    state.operations = operationsData;
    state.loadingZone = loadingZoneData;
    state.conveyorProduct = conveyorData;
    state.autoTasks = autoTasksData;

    renderCells();
    renderProducts();
    renderOperations();
    renderLoadingZone();
    renderAutoTasks();
    updateStats();
    updateCellSelects();
    updateProductSelects();

    if (conveyorData && conveyorData.has_product) {
      updateConveyor(conveyorData);
    }
  } catch (error) {
    console.error("Failed to load warehouse data:", error);
    showNotification("Error loading data", "warning");
  }
}

// ========== RENDER FUNCTIONS ==========
function renderCells() {
  elements.cellsGrid.innerHTML = "";

  state.cells.forEach((cell) => {
    const cellElement = document.createElement("div");
    cellElement.className = `cell ${cell.display_status === 'OCCUPIED' ? 'occupied' : 'empty'}`;
    cellElement.dataset.cellId = cell.id;
    cellElement.dataset.row = cell.row_num;
    cellElement.dataset.col = cell.col_num;

    const header = document.createElement("div");
    header.className = "cell-header";
    header.innerHTML = `
      <span>${cell.label}</span>
      <span class="cell-status">R${cell.row_num}C${cell.col_num}</span>
    `;

    const body = document.createElement("div");
    body.className = "cell-body";

    if (cell.product_id) {
      body.innerHTML = `
        <div class="cell-product-name">${cell.product_name || 'Unknown'}</div>
        <div class="cell-qty">Qty: ${cell.quantity}</div>
        ${cell.sku ? `<div class="cell-sku">SKU: ${cell.sku}</div>` : ''}
        ${cell.rfid_uid ? `<div class="cell-sku">RFID: ${cell.rfid_uid}</div>` : ''}
      `;
    } else {
      body.innerHTML = `<div class="cell-empty">Empty</div>`;
    }

    cellElement.appendChild(header);
    cellElement.appendChild(body);

    cellElement.addEventListener("click", () => handleCellClick(cell));

    elements.cellsGrid.appendChild(cellElement);
  });
}

function renderLoadingZone() {
  const loadingZoneContent = elements.loadingZone;
  if (!loadingZoneContent) return;

  if (state.loadingZone && state.loadingZone.product_id) {
    const product = state.products.find(
      (p) => p.id === state.loadingZone.product_id
    );
    if (product) {
      loadingZoneContent.innerHTML = `
        <div class="cell-product-name">${product.name}</div>
        <div class="cell-qty">Qty: ${state.loadingZone.quantity}</div>
        ${product.sku ? `<div class="cell-sku">SKU: ${product.sku}</div>` : ""}
      `;
    } else {
      loadingZoneContent.innerHTML = `
        <div class="cell-product-name">Unknown Product</div>
        <div class="cell-qty">Qty: ${state.loadingZone.quantity}</div>
      `;
    }
    if (elements.loadingStatus) {
      elements.loadingStatus.textContent = "Occupied";
    }
  } else {
    loadingZoneContent.innerHTML = '<div class="cell-empty">Empty</div>';
    if (elements.loadingStatus) {
      elements.loadingStatus.textContent = "Empty";
    }
  }
}

function renderProducts() {
  const productSelect = document.getElementById("product-select");
  const taskProductSelect = document.getElementById("task-product");

  if (productSelect) {
    productSelect.innerHTML = '<option value="">Select Product</option>';
    state.products.forEach((product) => {
      const option = document.createElement("option");
      option.value = product.id;
      option.textContent = `${product.name} (RFID: ${product.rfid_uid || 'N/A'})`;
      productSelect.appendChild(option);
    });
  }

  if (taskProductSelect) {
    taskProductSelect.innerHTML = '<option value="">Select Product</option>';
    state.products.forEach((product) => {
      const option = document.createElement("option");
      option.value = product.id;
      option.textContent = `${product.name} (RFID: ${product.rfid_uid || 'N/A'})`;
      taskProductSelect.appendChild(option);
    });
  }
}

function renderOperations() {
  const tbody = document.querySelector("#ops-table tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  state.operations.forEach((op) => {
    const row = document.createElement("tr");
    row.className = `status-${op.status.toLowerCase()}`;

    const time = new Date(op.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

    row.innerHTML = `
      <td>${op.id}</td>
      <td>${op.op_type}</td>
      <td><code>${op.cmd}</code></td>
      <td><span class="badge badge-${getStatusColor(
        op.status
      )}">${op.status}</span></td>
      <td>${op.cell_label || "-"}</td>
      <td>${op.product_name || "-"}</td>
      <td>${time}</td>
    `;

    tbody.appendChild(row);
  });
}

function renderAutoTasks() {
  if (!elements.taskQueue) return;

  elements.taskQueue.innerHTML = "";

  if (state.autoTasks.length === 0) {
    elements.taskQueue.innerHTML =
      '<div class="task-item empty-queue">No tasks in queue</div>';
    return;
  }

  state.autoTasks.forEach((task) => {
    const taskElement = document.createElement("div");
    taskElement.className = "task-item";
    taskElement.dataset.taskId = task.id;
    
    const priorityClass = task.priority.toLowerCase();
    const statusClass = task.status.toLowerCase();
    
    taskElement.innerHTML = `
      <div>
        <div class="task-type">${task.task_type}</div>
        <div class="task-meta">
          ${task.cell_label ? `Cell: ${task.cell_label}` : ''}
          ${task.product_name ? ` | Product: ${task.product_name}` : ''}
        </div>
      </div>
      <div>
        <span class="task-priority ${priorityClass}">${task.priority}</span>
        <span class="task-status ${statusClass}">${task.status}</span>
      </div>
    `;
    
    elements.taskQueue.appendChild(taskElement);
  });
}

function updateStats() {
  const total = state.cells.length;
  const occupied = state.cells.filter((cell) => cell.display_status === 'OCCUPIED').length;
  const available = total - occupied;

  if (elements.totalCells) elements.totalCells.textContent = total;
  if (elements.occupiedCells) elements.occupiedCells.textContent = occupied;
  if (elements.availableCells) elements.availableCells.textContent = available;
}

function updateCellSelects() {
  const selects = ["cell-select", "move-cell-select", "task-cell"];

  selects.forEach((selectId) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    select.innerHTML = '<option value="">Select Cell</option>';

    state.cells.forEach((cell) => {
      const option = document.createElement("option");
      option.value = cell.id;
      let status = cell.display_status === 'OCCUPIED' ? " (Occupied)" : " (Empty)";
      option.textContent = `${cell.label} - R${cell.row_num}C${cell.col_num}${status}`;
      select.appendChild(option);
    });
  });
}

function updateProductSelects() {
  const selects = ["product-select", "task-product"];

  selects.forEach((selectId) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    select.innerHTML = '<option value="">Select Product</option>';

    state.products.forEach((product) => {
      const option = document.createElement("option");
      option.value = product.id;
      option.textContent = `${product.name} (RFID: ${product.rfid_uid || 'N/A'})`;
      select.appendChild(option);
    });
  });
}

// ========== CELL CLICK HANDLER ==========
function handleCellClick(cell) {
  document.querySelectorAll(".cell.selected").forEach((el) => {
    el.classList.remove("selected");
  });

  const cellElement = document.querySelector(
    `[data-cell-id="${cell.id}"]`
  );
  if (cellElement) {
    cellElement.classList.add("selected");
  }

  // Update form inputs
  const colInput = document.getElementById("place-col");
  const rowInput = document.getElementById("place-row");
  const pickColInput = document.getElementById("pick-col");
  const pickRowInput = document.getElementById("pick-row");
  const cellSelect = document.getElementById("cell-select");
  const moveCellSelect = document.getElementById("move-cell-select");

  if (colInput) colInput.value = cell.col_num;
  if (rowInput) rowInput.value = cell.row_num;
  if (pickColInput) pickColInput.value = cell.col_num;
  if (pickRowInput) pickRowInput.value = cell.row_num;
  if (cellSelect) cellSelect.value = cell.id;
  if (moveCellSelect) moveCellSelect.value = cell.id;

  showNotification(`Selected ${cell.label}`, "info");
}

// ========== OPERATIONS (MANUAL COMMANDS) ==========
async function sendOperation(type, command, options = {}) {
  if (state.isLoading) {
    showNotification(
      "Please wait for current operation to complete",
      "warning"
    );
    return;
  }

  const hideLoader = showLoading(
    "Executing Command",
    `Sending command: ${command}`,
    estimateOperationTime(type)
  );

  try {
    if (elements.currentStep) {
      elements.currentStep.textContent = "Sending to ESP32...";
    }

    const result = await apiCall("/api/operations", "POST", {
      op_type: type,
      cmd: command,
      product_id: options.product_id || null,
      cell_id: options.cell_id || null,
      priority: options.priority || 'MEDIUM'
    });

    if (elements.currentStep) {
      elements.currentStep.textContent = "Waiting for completion...";
    }

    if (!result.success) {
      hideLoader();
      showNotification(`Operation failed: ${result.error}`, "error");
      return;
    }

    // Wait a moment for the operation to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await loadWarehouseData();

    hideLoader();
    showNotification("Operation completed successfully", "success");
  } catch (error) {
    hideLoader();
    console.error("Operation failed:", error);
    showNotification("Operation failed to execute", "error");
  }
}

function estimateOperationTime(type) {
  const times = {
    HOME: 5,
    PICK_FROM_CONVEYOR: 8,
    PLACE_IN_CELL: 8,
    TAKE_FROM_CELL: 8,
    GOTO_COLUMN: 5,
    MOVE_TO_LOADING: 10,
    RETURN_TO_LOADING: 10,
    AUTO_STOCK: 15
  };
  return times[type] || 6;
}

// ========== SENSOR / RFID UI UPDATE ==========
function updateSensors(data) {
  if (!data) return;

  if (data.ldr1 !== undefined) {
    state.sensorData.ldr1 = data.ldr1;
    const ldr1Light = elements.ldr1Indicator?.querySelector(".ldr-light");
    if (ldr1Light) {
      ldr1Light.classList.toggle("active", !!data.ldr1);
    }
  }

  if (data.ldr2 !== undefined) {
    state.sensorData.ldr2 = data.ldr2;
    const ldr2Light = elements.ldr2Indicator?.querySelector(".ldr-light");
    if (ldr2Light) {
      ldr2Light.classList.toggle("active", !!data.ldr2);
    }
  }

  if (elements.conveyor) {
    const hasProductVisual = state.sensorData.ldr1 || state.sensorData.ldr2;
    elements.conveyor.classList.toggle("product-detected", hasProductVisual);
  }

  if (data.rfid !== undefined && data.rfid !== null) {
    state.sensorData.rfid = data.rfid;
    if (elements.rfidTag) elements.rfidTag.textContent = data.rfid || "None";
    if (elements.currentRfid) elements.currentRfid.textContent = data.rfid || "None";
  }

  if (data.conveyorState) {
    state.sensorData.conveyorState = data.conveyorState;
    if (elements.conveyorStatus) {
      elements.conveyorStatus.textContent = `Conveyor: ${data.conveyorState}`;
      
      switch (data.conveyorState) {
        case "IDLE":
          elements.conveyorStatus.className = "badge badge-gray";
          break;
        case "MOVE_12CM":
        case "MOVING_TO_LDR2":
          elements.conveyorStatus.className = "badge badge-yellow";
          break;
        case "WAIT_RFID":
          elements.conveyorStatus.className = "badge badge-blue";
          break;
        case "STOPPED":
          elements.conveyorStatus.className = "badge badge-red";
          break;
        default:
          elements.conveyorStatus.className = "badge badge-gray";
      }
    }
    
    if (elements.autoConveyorState) {
      elements.autoConveyorState.textContent = data.conveyorState;
    }
  }
}

function updateRFID(tag, symbol, product, targetCell) {
  if (!tag) return;

  const label = symbol ? `${symbol} (${tag})` : tag;
  if (elements.rfidTag) elements.rfidTag.textContent = label;
  if (elements.currentRfid) elements.currentRfid.textContent = label;

  if (targetCell && targetCell.row && targetCell.col) {
    const cellLabel = `R${targetCell.row}C${targetCell.col}`;
    if (elements.targetCell) {
      elements.targetCell.textContent = cellLabel;
    }

    highlightTargetCell(targetCell.row, targetCell.col);
  }
}

function highlightTargetCell(row, col) {
  document.querySelectorAll(".cell").forEach((cell) => {
    cell.classList.remove("target-cell");
    cell.style.borderColor = "";
    cell.style.boxShadow = "";
  });

  const targetCellElement = document.querySelector(
    `.cell[data-row="${row}"][data-col="${col}"]`
  );
  if (targetCellElement) {
    targetCellElement.classList.add("target-cell");
    targetCellElement.style.borderColor = "#f59e0b";
    targetCellElement.style.boxShadow =
      "0 0 10px rgba(245, 158, 11, 0.5)";

    setTimeout(() => {
      targetCellElement.classList.remove("target-cell");
      targetCellElement.style.borderColor = "";
      targetCellElement.style.boxShadow = "";
    }, 5000);
  }
}

function updateConveyor(product) {
  state.conveyorProduct = product;
  if (!elements.conveyorProduct) return;

  if (product && product.has_product) {
    elements.conveyorProduct.textContent =
      product.product_name || "Product Detected";
    elements.conveyorProduct.classList.add("has-product");
    if (elements.conveyor) {
      elements.conveyor.classList.add("product-detected");
    }
  } else {
    elements.conveyorProduct.textContent = "Empty";
    elements.conveyorProduct.classList.remove("has-product");
    if (elements.conveyor) {
      elements.conveyor.classList.remove("product-detected");
    }
  }
}

// ========== REAL-TIME UPDATES ==========
function updateOperationStatus(operation) {
  if (!operation) return;
  
  // Update operations table
  const rows = document.querySelectorAll("#ops-table tbody tr");
  rows.forEach((row) => {
    if (row.cells[0].textContent == operation.id) {
      row.cells[3].innerHTML = `<span class="badge badge-${getStatusColor(
        operation.status
      )}">${operation.status}</span>`;
      row.className = `status-${operation.status.toLowerCase()}`;
    }
  });
}

function updateCell(cell) {
  if (!cell) return;
  
  const index = state.cells.findIndex((c) => c.id === cell.id);
  if (index !== -1) {
    state.cells[index] = cell;
    renderCells();
    updateStats();
    
    // Update cell selects if this cell changed status
    updateCellSelects();
  }
}

function updateAutoTask(task) {
  if (!task) return;
  
  const index = state.autoTasks.findIndex((t) => t.id === task.id);
  if (index !== -1) {
    state.autoTasks[index] = task;
  } else {
    state.autoTasks.push(task);
  }
  
  renderAutoTasks();
}

// ========== AUTO MODE CONTROL ==========
async function startAutoMode() {
  try {
    const res = await apiCall("/api/mode", "POST", { mode: "auto" });
    if (!res.success) {
      showNotification(`Failed to start auto: ${res.error}`, "error");
    } else {
      applyModeUI("auto");
      showNotification("Auto Mode started", "success");
      await loadWarehouseData();
    }
  } catch (err) {
    console.error("startAutoMode error:", err);
    showNotification("Failed to start auto mode", "error");
  }
}

async function stopAutoMode() {
  try {
    const res = await apiCall("/api/mode", "POST", { mode: "manual" });
    if (!res.success) {
      showNotification(`Failed to stop auto: ${res.error}`, "error");
    } else {
      applyModeUI("manual");
      showNotification("Auto Mode stopped", "info");
    }
  } catch (err) {
    console.error("stopAutoMode error:", err);
    showNotification("Failed to stop auto mode", "error");
  }
}

// ========== AUTO TASK MANAGEMENT ==========
async function addAutoTask(taskData) {
  try {
    const result = await apiCall("/api/auto-tasks", "POST", taskData);
    
    if (result.success) {
      showNotification("Task added to queue", "success");
      await loadWarehouseData();
    }
  } catch (error) {
    console.error("Error adding auto task:", error);
    showNotification("Failed to add task", "error");
  }
}

// ========== UI EVENT HANDLERS ==========
function setupEventHandlers() {
  // Mode switch
  if (elements.modeSelect) {
    elements.modeSelect.addEventListener("change", async (e) => {
      const mode = e.target.value;
      if (mode === "auto") {
        await startAutoMode();
      } else {
        await stopAutoMode();
      }
    });
  }

  // Manual control buttons
  const btnHome = document.getElementById("btn-home");
  if (btnHome) {
    btnHome.addEventListener("click", () => {
      sendOperation("HOME", "HOME");
    });
  }

  const btnPickConveyor = document.getElementById("btn-pick-conveyor");
  if (btnPickConveyor) {
    btnPickConveyor.addEventListener("click", () => {
      sendOperation("PICK_FROM_CONVEYOR", "PICK");
    });
  }

  const btnReturnLoading = document.getElementById("btn-return-loading");
  if (btnReturnLoading) {
    btnReturnLoading.addEventListener("click", () => {
      sendOperation("LOADING_RETURN", " RETURN_TO_LOADING");
    });
  }

  const btnGotoColumn = document.getElementById("btn-goto-column");
  if (btnGotoColumn) {
    btnGotoColumn.addEventListener("click", () => {
      const col = document.getElementById("goto-column")?.value;
      if (col) {
        sendOperation("GOTO_COLUMN", `GOTO ${col}`);
      }
    });
  }

  const btnPlace = document.getElementById("btn-place");
  if (btnPlace) {
    btnPlace.addEventListener("click", () => {
      const col = document.getElementById("place-col")?.value;
      const row = document.getElementById("place-row")?.value;
      if (col && row) {
        sendOperation("PLACE_IN_CELL", `PLACE ${col} ${row}`);
      }
    });
  }

  const btnPickCell = document.getElementById("btn-pick-cell");
  if (btnPickCell) {
    btnPickCell.addEventListener("click", () => {
      const col = document.getElementById("pick-col")?.value;
      const row = document.getElementById("pick-row")?.value;
      if (col && row) {
        sendOperation("TAKE_FROM_CELL", `TAKE ${col} ${row}`);
      }
    });
  }

  const btnManualCmd = document.getElementById("btn-manual-cmd");
  if (btnManualCmd) {
    btnManualCmd.addEventListener("click", () => {
      const cmd = document.getElementById("manual-cmd")?.value.trim();
      if (!cmd) {
        showNotification("Please enter a command", "warning");
        return;
      }
      sendOperation("MANUAL_CMD", cmd);
    });
  }

  // Auto mode controls
  const btnStartAuto = document.getElementById("btn-start-auto");
  if (btnStartAuto) {
    btnStartAuto.addEventListener("click", () => {
      startAutoMode();
    });
  }

  const btnStopAuto = document.getElementById("btn-stop-auto");
  if (btnStopAuto) {
    btnStopAuto.addEventListener("click", () => {
      stopAutoMode();
    });
  }

  // Product management
  const btnAddProduct = document.getElementById("btn-add-product");
  if (btnAddProduct) {
    btnAddProduct.addEventListener("click", async () => {
      const name = document.getElementById("prod-name")?.value.trim();
      const sku = document.getElementById("prod-sku")?.value.trim();
      const rfid = document.getElementById("prod-rfid")?.value.trim();

      if (!name) {
        showNotification("Product name is required", "error");
        return;
      }

      try {
        await apiCall("/api/products", "POST", {
          name,
          sku: sku || null,
          rfid_uid: rfid || null
        });

        showNotification("Product added successfully", "success");

        const prodNameInput = document.getElementById("prod-name");
        const prodSkuInput = document.getElementById("prod-sku");
        const prodRfidInput = document.getElementById("prod-rfid");
        
        if (prodNameInput) prodNameInput.value = "";
        if (prodSkuInput) prodSkuInput.value = "";
        if (prodRfidInput) prodRfidInput.value = "";

        await loadWarehouseData();
      } catch (error) {
        showNotification("Failed to add product", "error");
      }
    });
  }

  const btnAssignProduct = document.getElementById("btn-assign-product");
  if (btnAssignProduct) {
    btnAssignProduct.addEventListener("click", async () => {
      const cellId = document.getElementById("cell-select")?.value;
      const productId = document.getElementById("product-select")?.value;
      const qtyInput = document.getElementById("product-qty");
      const qty = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;

      if (!cellId || !productId) {
        showNotification("Please select both cell and product", "warning");
        return;
      }

      try {
        await apiCall(`/api/cells/${cellId}/assign`, "POST", {
          product_id: productId,
          quantity: qty
        });

        showNotification("Product assigned successfully", "success");
        await loadWarehouseData();
      } catch (error) {
        showNotification("Failed to assign product", "error");
      }
    });
  }

  const btnMoveToLoading = document.getElementById("btn-move-to-loading");
  if (btnMoveToLoading) {
    btnMoveToLoading.addEventListener("click", async () => {
      const cellId = document.getElementById("move-cell-select")?.value;

      if (!cellId) {
        showNotification("Please select a cell", "warning");
        return;
      }

      const cell = state.cells.find((c) => c.id == cellId);
      if (!cell || !cell.product_id) {
        showNotification("Selected cell is empty", "warning");
        return;
      }

      sendOperation(
        "MOVE_TO_LOADING",
        `LOADING_TAKE ${cell.col_num} ${cell.row_num}`,
        {
          cell_id: cellId,
          product_id: cell.product_id
        }
      );
    });
  }

  // Auto task management
  const btnAddTask = document.getElementById("btn-add-task");
  if (btnAddTask) {
    btnAddTask.addEventListener("click", () => {
      if (elements.taskModal) {
        elements.taskModal.classList.add("active");
      }
    });
  }

  // Modal handlers
  const modalClose = elements.taskModal?.querySelector(".modal-close");
  if (modalClose) {
    modalClose.addEventListener("click", () => {
      elements.taskModal.classList.remove("active");
    });
  }

  const btnCancelTask = document.getElementById("btn-cancel-task");
  if (btnCancelTask) {
    btnCancelTask.addEventListener("click", () => {
      elements.taskModal.classList.remove("active");
    });
  }

  const btnSaveTask = document.getElementById("btn-save-task");
  if (btnSaveTask) {
    btnSaveTask.addEventListener("click", async () => {
      const type = document.getElementById("task-type")?.value;
      const cellId = document.getElementById("task-cell")?.value;
      const productId = document.getElementById("task-product")?.value;
      const priority = document.getElementById("task-priority")?.value;

      if (!type) {
        showNotification("Please select task type", "warning");
        return;
      }

      await addAutoTask({
        task_type: type,
        cell_id: cellId || null,
        product_id: productId || null,
        priority: priority || 'MEDIUM',
        quantity: 1
      });

      elements.taskModal.classList.remove("active");
    });
  }

  // Quick action buttons
  const btnAutoStock = document.getElementById("btn-auto-stock");
  if (btnAutoStock) {
    btnAutoStock.addEventListener("click", async () => {
      await addAutoTask({
        task_type: "STOCK",
        priority: "MEDIUM"
      });
    });
  }

  const btnAutoRetrieve = document.getElementById("btn-auto-retrieve");
  if (btnAutoRetrieve) {
    btnAutoRetrieve.addEventListener("click", async () => {
      await addAutoTask({
        task_type: "RETRIEVE",
        priority: "MEDIUM"
      });
    });
  }

  // Refresh button
  const btnRefreshOps = document.getElementById("btn-refresh-ops");
  if (btnRefreshOps) {
    btnRefreshOps.addEventListener("click", () => {
      loadWarehouseData();
      showNotification("Data refreshed", "info");
    });
  }

  // Manual command enter key
  const manualCmdInput = document.getElementById("manual-cmd");
  if (manualCmdInput) {
    manualCmdInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        document.getElementById("btn-manual-cmd")?.click();
      }
    });
  }
}

// ========== NOTIFICATIONS & HELPERS ==========
function showNotification(message, type = "info") {
  const existing = document.querySelector(".notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <span class="notification-icon">${getNotificationIcon(type)}</span>
      <span class="notification-message">${message}</span>
    </div>
  `;

  document.body.appendChild(notification);

  setTimeout(() => notification.classList.add("show"), 10);

  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function getNotificationIcon(type) {
  const icons = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️"
  };
  return icons[type] || "ℹ️";
}

function getStatusColor(status) {
  const colors = {
    PENDING: "yellow",
    PROCESSING: "blue",
    COMPLETED: "green",
    ERROR: "red",
    CANCELLED: "gray"
  };
  return colors[status] || "gray";
}

// ========== INITIALIZATION ==========
async function init() {
  setupEventHandlers();
  connectWebSocket();
  await loadWarehouseData();

  // Auto-refresh data every 10 seconds
  setInterval(async () => {
    if (state.isConnected) {
      await loadWarehouseData();
    }
  }, 10000);

  setTimeout(() => {
    showNotification("Smart Warehouse System Ready", "success");
  }, 1000);
}

// Start the application
document.addEventListener("DOMContentLoaded", init);