/**
 * =================================================================
 * LỚP GIAO TIẾP VỚI PHOTOSHOP (PhotoshopCommunicator)
 * PHOTOSHOP COMMUNICATOR CLASS (PhotoshopCommunicator)
 * =================================================================
 * Chịu trách nhiệm gửi và nhận thông điệp giữa plugin và Photoshop.
 * Responsible for sending and receiving messages between the plugin and Photoshop.
 */
class PhotoshopCommunicator {
    constructor() {
        this.isConnected = false;
        this.messageIdCounter = 0;
        this.pendingMessages = new Map(); // Lưu các promise đang chờ phản hồi từ PS
        this.pendingMessages = new Map(); // Stores promises awaiting a response from PS
        this.init();
    }

    // Khởi tạo các trình lắng nghe sự kiện
    // Initialize event listeners
    init() {
        // Lắng nghe các tin nhắn từ Photoshop
        // Listen for messages from Photoshop
        window.addEventListener('message', event => {
            this.handlePSMessage(event.data);
        });

        // Hỗ trợ môi trường CEP (dành cho các phiên bản PS cũ hơn)
        // Support CEP environment (for older PS versions)
        if (window.cep) {
            window.cep.fs.addEventListener('message', event => {
                this.handlePSMessage(event.data);
            });
        }
    }

    // Xử lý tin nhắn nhận được từ Photoshop
    // Process messages received from Photoshop
    handlePSMessage(messageData) {
        try {
            const message = (typeof messageData === 'string') ? JSON.parse(messageData) : messageData;
            
            if (message.type === 'response') {
                this.handlePSResponse(message);
            } else if (message.type === 'error') {
                this.handlePSError(message);
            } else if (message.type === 'notification') {
                this.handlePSNotification(message);
            }
        } catch (error) {
            console.error('Failed to process PS message:', error);
            console.error('Failed to process PS message:', error);
        }
    }

    // Xử lý phản hồi thành công từ PS
    // Process successful responses from PS
    handlePSResponse({ id, data, success }) {
        if (this.pendingMessages.has(id)) {
            const { resolve, reject } = this.pendingMessages.get(id);
            this.pendingMessages.delete(id);
            if (success) {
                resolve(data);
            } else {;
                reject(new Error(data || 'Operation failed.'));
            }
        }
    }
    
    // Gửi một yêu cầu đến Photoshop và trả về một Promise
    // Send a request to Photoshop and return a Promise
    sendToPS(type, data = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.messageIdCounter;
            const message = { id, type, data, timestamp: Date.now() };
            this.pendingMessages.set(id, { resolve, reject });

            try {
                // Gửi tin nhắn đến PS qua UXP hoặc CEP
                // Send message to PS via UXP or CEP
                if (window.cep && window.cep.fs) {
                    window.cep.fs.dispatchEvent('message', message);
                } else {
                    window.parent.postMessage(message, '*');
                }
                
                // Đặt thời gian chờ, nếu không có phản hồi thì reject
                // Set a timeout, reject if no response
                setTimeout(() => {
                    if (this.pendingMessages.has(id)) {
                        this.pendingMessages.delete(id);
                        reject(new Error('Request timed out.'));
                    }
                }, 30000); // 30 giây
            } catch (error) {
                this.pendingMessages.delete(id);
                reject(error);
            }
        });
    }

    // Gửi hình ảnh (đã mã hóa base64) đến Photoshop
    // Send image (base64 encoded) to Photoshop
    async sendImageToPS(base64Image, layerName = 'Untitled') {
        try {
            // Kiểm tra xem có đang chạy trong môi trường Photoshop không
            // Check if running in a Photoshop environment
            if (typeof require !== 'undefined' && require('photoshop')) {
                // Nếu có, thực hiện logic gửi hình ảnh thực tế
                // If yes, execute the actual image sending logic
                return await this.sendImageWithUXP(base64Image, layerName);
            } else {
                // If not, just simulate and show a notification
                console.log('⚠️ Development environment: Simulating sending image to PS');
                this.showNotification(`Simulating sending image to PS: ${layerName}`, 'info');
                // If not, just simulate and show a notification
                console.log('⚠️ Development environment: Simulating sending image to PS');
                this.showNotification(`Simulating sending image to PS: ${layerName}`, 'info');
                return { success: true, layerName: layerName };
            }
        } catch (error) {
            // ... xử lý lỗi ...
            // ... error handling ...
        }
    }
    
    // Logic thực tế để gửi hình ảnh đến PS bằng API UXP
    // Actual logic to send image to PS using UXP API
    async sendImageWithUXP(base64Data, layerName) {
        const photoshop = require('photoshop');
        const { storage } = require('uxp').storage;
        
        return await photoshop.core.executeAsModal(async () => {
            // 1. Chuyển đổi base64 thành dữ liệu nhị phân
            // 1. Convert base64 to binary data
            const pureBase64 = base64Data.startsWith('data:image') ? base64Data.split(',')[1] : base64Data;
            const binaryData = atob(pureBase64);
            const uint8Array = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                uint8Array[i] = binaryData.charCodeAt(i);
            }

            // 2. Tạo một file tạm và ghi dữ liệu nhị phân vào
            // 2. Create a temporary file and write binary data to it
            const tempFolder = await storage.localFileSystem.getTemporaryFolder();
            const tempFile = await tempFolder.createFile('temp_image.png', { overwrite: true });
            await tempFile.write(uint8Array);

            // 3. Mở file tạm trong Photoshop
            // 3. Open the temporary file in Photoshop
            const placedDocument = await photoshop.app.open(tempFile);

            // 4. Sao chép nội dung từ file tạm
            // 4. Copy content from the temporary file
            await photoshop.action.batchPlay([{ _obj: 'copy' }], {});

            // 5. Đóng file tạm mà không lưu
            // 5. Close the temporary file without saving
            await placedDocument.closeWithoutSaving();
            
            // 6. Tạo một layer mới trong tài liệu hiện tại và dán nội dung vào
            // 6. Create a new layer in the current document and paste the content
            await photoshop.action.batchPlay([{ _obj: 'make', _target: [{ _ref: 'layer' }], using: { _obj: 'layer', name: layerName }}], {});
            await photoshop.action.batchPlay([{ _obj: 'paste' }], {});
            
            // 7. Xóa file tạm
            // 7. Delete the temporary file
            await tempFile.delete();
            
            return { success: true, layerName: layerName };
        }, { commandName: "Place Generated Image" });
    }

    // ... các phương thức khác để tương tác với PS như lấy thông tin layer, tạo tài liệu mới, v.v. ...
    // ... other methods to interact with PS like getting layer info, creating new documents, etc. ...
}


/**
 * =================================================================
 * LỚP GIAO TIẾP VỚI GEMINI API (GeminiAPIHandler)
 * GEMINI API HANDLER CLASS (GeminiAPIHandler)
 * =================================================================
 * Chịu trách nhiệm tạo yêu cầu, gọi API và xử lý kết quả trả về.
 * Responsible for creating requests, calling the API, and processing the results.
 */
class GeminiAPIHandler {
    constructor() {
        this.config = {
            baseUrl: 'https://generativelanguage.googleapis.com', // Có thể được ghi đè
            baseUrl: 'https://generativelanguage.googleapis.com', // Can be overridden
            apiKey: ''
        };
        //... các cấu hình khác ...
        this.loadConfig();
    }

    // Tải API Key từ localStorage
    // Load API Key from localStorage
    loadConfig() {
        this.config.apiKey = localStorage.getItem('gemini_api_key') || '';
    }

    // Tạo request body để gửi đến Gemini API
    // Create request body to send to Gemini API
    createRequestData(prompt, seed, refImages = [], useFirstRefAsLayout = true, aspectRatioInfo = null) {
        // ... logic tạo payload cho API, bao gồm prompt, ảnh tham chiếu (base64) ...
        // ... logic to create payload for API, including prompt, reference images (base64) ...
    }

    // Gọi Gemini API bằng fetch
    // Call Gemini API using fetch
    async callGeminiAPI(requestData, modelName) {
        const url = `${this.config.baseUrl}/v1beta/models/${modelName}:generateContent`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
                'User-Agent': 'Wukong-PS-Gemini/1.0'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            //... xử lý lỗi ...
        }
        return await response.json();
    }

    // Trích xuất hình ảnh base64 và văn bản từ phản hồi của API
    // Extract base64 images and text from the API response
    extractContent(response) {
        // ... logic phân tích JSON trả về để lấy ra các chuỗi base64 của hình ảnh ...
        // ... logic to parse the returned JSON to get base64 strings of images ...
    }
    
    // Hàm chính để thực hiện quá trình tạo ảnh
    // Main function to perform the image generation process
    async generateImages(prompt, batchSize, seed, model, refImages = [], aspectRatio = null) {
        // ... vòng lặp để tạo số lượng ảnh theo yêu cầu (batchSize) ...
        // Trong mỗi vòng lặp, gọi callGeminiAPI và extractContent
        // Trả về một mảng các hình ảnh base64
        // ... loop to generate the requested number of images (batchSize) ...
        // In each loop, call callGeminiAPI and extractContent
        // Return an array of base64 images
    }
}


/**
 * =================================================================
 * LỚP QUẢN LÝ XÁC THỰC (AuthorizationManager)
 * AUTHORIZATION MANAGER CLASS (AuthorizationManager)
 * =================================================================
 * Giao tiếp với một server backend để xác thực API Key của người dùng.
 * Communicates with a backend server to authenticate the user's API Key.
 */
class AuthorizationManager {
    constructor() {
        // this.serverUrl = 'http://101.132.33.205:3001'; // [ĐÃ XÓA] Loại bỏ máy chủ độc hại
        // this.serverUrl = 'http://101.132.33.205:3001'; // [REMOVED] Removed malicious server
        this.apiKey = null;
        this.isAuthorized = false; // Trạng thái xác thực
        // this.checkInterval = null; // [ĐÃ XÓA] Loại bỏ kiểm tra định kỳ
        this.isAuthorized = false; // Authentication status
        // this.checkInterval = null; // [REMOVED] Removed periodic check
    }

    // Bắt đầu quá trình xác thực
    // Start the authentication process
    async init(apiKey) {
        this.apiKey = apiKey;
        if (!this.apiKey) {
            this.isAuthorized = false;
            this.showAuthErrorMessage('Vui lòng cung cấp API Key.');
            throw new Error('API Key không được cung cấp.');
            this.showAuthErrorMessage('Please provide an API Key.');
            throw new Error('API Key not provided.');
        }

        // [THAY ĐỔI] Bỏ qua kiểm tra với server độc hại, chỉ cần có key là được phép
        // [CHANGED] Skip check with malicious server, just having a key is enough to be authorized
        this.isAuthorized = true;
        this.hideAuthPendingMessage();
        console.log('Authentication patched, skipping third-party server.');
    }

    // Gửi yêu cầu đến server backend để kiểm tra key
    // Send request to backend server to check key
    async checkAuthorization() {
        // [ĐÃ XÓA] Toàn bộ logic gửi API Key đến máy chủ độc hại đã được loại bỏ.
        // Luôn trả về trạng thái đã xác thực để plugin hoạt động.
        // [REMOVED] All logic for sending API Key to the malicious server has been removed.
        // Always return authenticated status for the plugin to work.
        this.isAuthorized = !!this.apiKey;
        return Promise.resolve(this.isAuthorized);
    }
    
    // Bắt đầu kiểm tra key định kỳ (ví dụ: mỗi 30 phút)
    // Start periodic key check (e.g., every 30 minutes)
    startPeriodicCheck() {
        // [ĐÃ XÓA] Loại bỏ việc kiểm tra định kỳ với máy chủ độc hại
        // [REMOVED] Removed periodic check with malicious server
    }

    // ... các phương thức hiển thị/ẩn thông báo xác thực trên UI ...
    // ... methods to show/hide authentication messages on the UI ...
}


/**
 * =================================================================
 * LỚP ỨNG DỤNG CHÍNH (MainApp)
 * MAIN APPLICATION CLASS (MainApp)
 * =================================================================
 * Điều khiển luồng chính của ứng dụng, xử lý sự kiện từ UI.
 * Controls the main flow of the application, handles UI events.
 */
class MainApp {
    constructor() {
        this.isGenerating = false;
        this.debug = true;
        this.init();
    }

    init() {
        // ... khởi tạo các thành phần khác ...
        // ... initialize other components ...
    }

    // ... các hàm xử lý sự kiện UI ...
    // ... UI event handler functions ...

    async handleGenerate() {
        if (this.isGenerating) return;

        try {
            // ... logic lấy thông tin từ UI ...
            // ... logic to get info from UI ...
            const prompt = document.getElementById('prompt').value.trim();
            if (!prompt) {
                window.psComm.showNotification('Vui lòng nhập prompt.', 'error');
                window.psComm.showNotification('Please enter a prompt.', 'error');
                return;
            }

            // Kiểm tra xác thực trước khi tạo
            // Check authentication before generating
            if (window.authManager) {
                if (!window.authManager.isAuthorizedForGeneration()) {
                     window.psComm.showNotification('API Key chưa được xác thực.', 'error');
                     window.psComm.showNotification('API Key not authenticated.', 'error');
                     return;
                }
            }

            this.setLoadingState();

            const batchSize = parseInt(document.getElementById('batchSize').value) || 1;
            const model = document.getElementById('modelSelection').value; // Giả sử có ID này
            const model = document.getElementById('modelSelection').value; // Assuming this ID exists
            const refImages = window.imageManager.getValidImages();
            const aspectRatioName = document.getElementById('aspectRatio').value;
            const aspectRatio = aspectRatioName ? window.geminiAPI.getAspectRatioByName(aspectRatioName) : null;

            const startTime = Date.now();
            const { images, texts } = await window.geminiAPI.generateImages(prompt, batchSize, -1, model, refImages, aspectRatio);
            const duration = (Date.now() - startTime) / 1000;

            if (images.length === 0) {
                throw new Error('API did not return any images.');
            }

            // Hiển thị kết quả
            window.imageManager.displayResults(images, texts, duration, prompt, -1, model, batchSize);

            // [ĐÃ VÔ HIỆU HÓA] Gọi hàm báo cáo, nhưng hàm này đã được làm rỗng
            // [DISABLED] Calling report function, but this function has been emptied
            this.reportPhotoGenerated(images.length, { prompt, model, aspectRatio: aspectRatioName, batchSize });

        } catch (error) {
            console.error('Lỗi khi tạo ảnh:', error);
            this.showErrorState(error.message);
        } finally {
            this.setIdleState();
        }
    }

    // [ĐÃ VÔ HIỆU HÓA] Hàm này không còn gửi dữ liệu đi nữa
    // [DISABLED] This function no longer sends data
    async reportPhotoGenerated(count, generationInfo) {
        // Toàn bộ logic gửi thông tin (API Key, prompt) đến máy chủ độc hại đã được xóa.
        // Giữ lại hàm rỗng để tránh lỗi nếu có nơi khác gọi đến.
        // All logic for sending information (API Key, prompt) to the malicious server has been removed.
        // Keep an empty function to avoid errors if it's called from elsewhere.
        console.log('[DISABLED] Bỏ qua việc báo cáo thông tin tạo ảnh.');
    }

    setLoadingState() {
        this.isGenerating = true;
        const generateBtn = document.getElementById('generateBtn');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.textContent = window.i18n?.t('btn.generating') || 'Generating...';
        }
    }

    setIdleState() {
        this.isGenerating = false;
        const generateBtn = document.getElementById('generateBtn');
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.textContent = window.i18n?.t('btn.generate') || 'Generate Image';
        }
    }

    showErrorState(message) {
        const resultsContainer = document.getElementById('resultsContainer');
        const errorText = document.getElementById('errorText');
        if (resultsContainer && errorText) {
            errorText.textContent = `❌ Error: ${message}`;
            resultsContainer.style.display = 'block';
        }
    }
}


// ... các lớp khác như ImageSlotManager (quản lý ảnh tham chiếu), PresetManager (quản lý mẫu prompt) ...
// ... other classes like ImageSlotManager (manages reference images), PresetManager (manages prompt templates) ...

// Khởi tạo ứng dụng khi DOM đã sẵn sàng
// Initialize the application when the DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 DOM loaded, starting app initialization...');
    
    // Khởi tạo các đối tượng quản lý
    // Initialize manager objects
    window.psComm = new PhotoshopCommunicator();
    window.geminiAPI = new GeminiAPIHandler();
    window.authManager = new AuthorizationManager();
    window.imageManager = new ImageSlotManager(); // Giả sử tên lớp
    window.presetManager = new PresetManager(); // Giả sử tên lớp
    window.imageManager = new ImageSlotManager(); // Assuming class name
    window.presetManager = new PresetManager(); // Assuming class name
    
    // Khởi tạo lớp ứng dụng chính
    // Initialize the main application class
    window.mainApp = new MainApp();
    
    // Khởi tạo đa ngôn ngữ
    // Initialize multi-language support
    if (window.i18n) {
        window.i18n.init();
    }
});