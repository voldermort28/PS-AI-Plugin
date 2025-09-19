/**
 * =================================================================
 * LỚP GIAO TIẾP VỚI PHOTOSHOP (PhotoshopCommunicator)
 * =================================================================
 * Chịu trách nhiệm gửi và nhận thông điệp giữa plugin và Photoshop.
 */
class PhotoshopCommunicator {
    constructor() {
        this.isConnected = false;
        this.messageIdCounter = 0;
        this.pendingMessages = new Map(); // Lưu các promise đang chờ phản hồi từ PS
        this.init();
    }

    // Khởi tạo các trình lắng nghe sự kiện
    init() {
        // Lắng nghe các tin nhắn từ Photoshop
        window.addEventListener('message', event => {
            this.handlePSMessage(event.data);
        });

        // Hỗ trợ môi trường CEP (dành cho các phiên bản PS cũ hơn)
        if (window.cep) {
            window.cep.fs.addEventListener('message', event => {
                this.handlePSMessage(event.data);
            });
        }
    }

    // Xử lý tin nhắn nhận được từ Photoshop
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
            console.error('Xử lý tin nhắn PS thất bại:', error);
        }
    }

    // Xử lý phản hồi thành công từ PS
    handlePSResponse({ id, data, success }) {
        if (this.pendingMessages.has(id)) {
            const { resolve, reject } = this.pendingMessages.get(id);
            this.pendingMessages.delete(id);
            if (success) {
                resolve(data);
            } else {
                reject(new Error(data || 'Thao tác thất bại.'));
            }
        }
    }
    
    // Gửi một yêu cầu đến Photoshop và trả về một Promise
    sendToPS(type, data = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.messageIdCounter;
            const message = { id, type, data, timestamp: Date.now() };
            this.pendingMessages.set(id, { resolve, reject });

            try {
                // Gửi tin nhắn đến PS qua UXP hoặc CEP
                if (window.cep && window.cep.fs) {
                    window.cep.fs.dispatchEvent('message', message);
                } else {
                    window.parent.postMessage(message, '*');
                }
                
                // Đặt thời gian chờ, nếu không có phản hồi thì reject
                setTimeout(() => {
                    if (this.pendingMessages.has(id)) {
                        this.pendingMessages.delete(id);
                        reject(new Error('Yêu cầu hết thời gian chờ.'));
                    }
                }, 30000); // 30 giây
            } catch (error) {
                this.pendingMessages.delete(id);
                reject(error);
            }
        });
    }

    // Gửi hình ảnh (đã mã hóa base64) đến Photoshop
    async sendImageToPS(base64Image, layerName = 'Untitled') {
        try {
            // Kiểm tra xem có đang chạy trong môi trường Photoshop không
            if (typeof require !== 'undefined' && require('photoshop')) {
                // Nếu có, thực hiện logic gửi hình ảnh thực tế
                return await this.sendImageWithUXP(base64Image, layerName);
            } else {
                // Nếu không, chỉ giả lập và hiển thị thông báo
                console.log('⚠️ Môi trường phát triển: Giả lập gửi ảnh đến PS');
                this.showNotification(`Giả lập gửi ảnh đến PS: ${layerName}`, 'info');
                return { success: true, layerName: layerName };
            }
        } catch (error) {
            // ... xử lý lỗi ...
        }
    }
    
    // Logic thực tế để gửi hình ảnh đến PS bằng API UXP
    async sendImageWithUXP(base64Data, layerName) {
        const photoshop = require('photoshop');
        const { storage } = require('uxp').storage;
        
        return await photoshop.core.executeAsModal(async () => {
            // 1. Chuyển đổi base64 thành dữ liệu nhị phân
            const pureBase64 = base64Data.startsWith('data:image') ? base64Data.split(',')[1] : base64Data;
            const binaryData = atob(pureBase64);
            const uint8Array = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
                uint8Array[i] = binaryData.charCodeAt(i);
            }

            // 2. Tạo một file tạm và ghi dữ liệu nhị phân vào
            const tempFolder = await storage.localFileSystem.getTemporaryFolder();
            const tempFile = await tempFolder.createFile('temp_image.png', { overwrite: true });
            await tempFile.write(uint8Array);

            // 3. Mở file tạm trong Photoshop
            const placedDocument = await photoshop.app.open(tempFile);

            // 4. Sao chép nội dung từ file tạm
            await photoshop.action.batchPlay([{ _obj: 'copy' }], {});

            // 5. Đóng file tạm mà không lưu
            await placedDocument.closeWithoutSaving();
            
            // 6. Tạo một layer mới trong tài liệu hiện tại và dán nội dung vào
            await photoshop.action.batchPlay([{ _obj: 'make', _target: [{ _ref: 'layer' }], using: { _obj: 'layer', name: layerName }}], {});
            await photoshop.action.batchPlay([{ _obj: 'paste' }], {});
            
            // 7. Xóa file tạm
            await tempFile.delete();
            
            return { success: true, layerName: layerName };
        }, { commandName: "Place Generated Image" });
    }

    // ... các phương thức khác để tương tác với PS như lấy thông tin layer, tạo tài liệu mới, v.v. ...
}


/**
 * =================================================================
 * LỚP GIAO TIẾP VỚI GEMINI API (GeminiAPIHandler)
 * =================================================================
 * Chịu trách nhiệm tạo yêu cầu, gọi API và xử lý kết quả trả về.
 */
class GeminiAPIHandler {
    constructor() {
        this.config = {
            baseUrl: 'https://generativelanguage.googleapis.com', // Có thể được ghi đè
            apiKey: ''
        };
        //... các cấu hình khác ...
        this.loadConfig();
    }

    // Tải API Key từ localStorage
    loadConfig() {
        this.config.apiKey = localStorage.getItem('gemini_api_key') || '';
    }

    // Tạo request body để gửi đến Gemini API
    createRequestData(prompt, seed, refImages = [], useFirstRefAsLayout = true, aspectRatioInfo = null) {
        // ... logic tạo payload cho API, bao gồm prompt, ảnh tham chiếu (base64) ...
    }

    // Gọi Gemini API bằng fetch
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
    extractContent(response) {
        // ... logic phân tích JSON trả về để lấy ra các chuỗi base64 của hình ảnh ...
    }
    
    // Hàm chính để thực hiện quá trình tạo ảnh
    async generateImages(prompt, batchSize, seed, model, refImages = [], aspectRatio = null) {
        // ... vòng lặp để tạo số lượng ảnh theo yêu cầu (batchSize) ...
        // Trong mỗi vòng lặp, gọi callGeminiAPI và extractContent
        // Trả về một mảng các hình ảnh base64
    }
}


/**
 * =================================================================
 * LỚP QUẢN LÝ XÁC THỰC (AuthorizationManager)
 * =================================================================
 * Giao tiếp với một server backend để xác thực API Key của người dùng.
 */
class AuthorizationManager {
    constructor() {
        this.serverUrl = 'http://101.132.33.205:3001';
        this.apiKey = null;
        this.isAuthorized = false; // Trạng thái xác thực
        this.checkInterval = null; // Biến cho việc kiểm tra định kỳ
    }

    // Bắt đầu quá trình xác thực
    async init(apiKey) {
        this.apiKey = apiKey;
        if (!this.apiKey) throw new Error('API Key không được cung cấp.');
        
        await this.checkAuthorization(); // Kiểm tra với server
        if (this.isAuthorized) {
            this.hideAuthPendingMessage();
        } else {
            this.showAuthPendingMessage();
        }
        this.startPeriodicCheck(); // Bắt đầu kiểm tra định kỳ
    }

    // Gửi yêu cầu đến server backend để kiểm tra key
    async checkAuthorization() {
        try {
            const response = await fetch(`${this.serverUrl}/api/authorize?apiKey=${encodeURIComponent(this.apiKey)}`);
            if (!response.ok) {
                 throw new Error(`Xác thực thất bại: ${response.status}`);
            }
            const result = await response.json();
            this.isAuthorized = result.exists && result.authorized;
        } catch (error) {
            console.error('Lỗi khi kiểm tra xác thực:', error);
            this.isAuthorized = false; // Mặc định là không được phép nếu có lỗi
            throw error;
        }
    }
    
    // Bắt đầu kiểm tra key định kỳ (ví dụ: mỗi 30 phút)
    startPeriodicCheck() {
        if (this.checkInterval) clearInterval(this.checkInterval);
        this.checkInterval = setInterval(async () => {
            // ... gọi lại checkAuthorization() ...
        }, 1800000); // 30 phút
    }

    // ... các phương thức hiển thị/ẩn thông báo xác thực trên UI ...
}


// ... các lớp khác như ImageSlotManager (quản lý ảnh tham chiếu), PresetManager (quản lý mẫu prompt), và MainApp (lớp chính điều khiển) ...

// Khởi tạo ứng dụng khi DOM đã sẵn sàng
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 DOM đã tải xong, bắt đầu khởi tạo ứng dụng...');
    
    // Khởi tạo các đối tượng quản lý
    window.psComm = new PhotoshopCommunicator();
    window.geminiAPI = new GeminiAPIHandler();
    window.authManager = new AuthorizationManager();
    window.imageManager = new ImageSlotManager(); // Giả sử tên lớp
    window.presetManager = new PresetManager(); // Giả sử tên lớp
    
    // Khởi tạo lớp ứng dụng chính
    window.mainApp = new MainApp();
    
    // Khởi tạo đa ngôn ngữ
    if (window.i18n) {
        window.i18n.init();
    }
});