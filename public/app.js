const socket = io();
let pc;
let sendChannel;
let receiveChannel;
let fileToSend;
let fileName;
let fileSize;
let sendOffset = 0;
const CHUNK_SIZE = 65536; // 64KB chunk size
const MAX_BUFFERED_AMOUNT = 262144; // 256KB WebRTC buffer size limit

// UI Elements
const senderUI = document.getElementById('senderUI');
const receiverUI = document.getElementById('receiverUI');
const fileInput = document.getElementById('fileInput');
const selectFile = document.getElementById('selectFile');
const shareLink = document.getElementById('shareLink');
const status = document.getElementById('status');
const downloadButton = document.getElementById('downloadButton');
const receiverProgressContainer = document.getElementById('receiverProgressContainer');
const receiverProgressBar = document.getElementById('receiverProgressBar');
const receiverStatusMessage = document.getElementById('receiverStatusMessage');

// Determine if the user is the receiver
const isReceiver = window.location.hash.substring(1);

if (isReceiver) {
    // Show receiver UI and set up socket connection
    senderUI.style.display = 'none';
    receiverUI.style.display = 'block';
    socket.emit('join', isReceiver);
} else {
    // Show sender UI and handle file input
    selectFile.onclick = () => fileInput.click();
    fileInput.onchange = handleFileInputChange;
}

// Handle file input change
function handleFileInputChange() {
    fileToSend = fileInput.files[0];
    fileName = fileToSend.name;
    fileSize = fileToSend.size;
    socket.emit('create');
}

// Socket events
socket.on('created', (roomId) => {
    shareLink.textContent = `Share this link: ${window.location.href}#${roomId}`;
    initPeerConnection(true);
});

socket.on('joined', () => {
    initPeerConnection(false);
});

socket.on('full', () => {
    alert('The room is full');
});

socket.on('ready', () => {
    if (!isReceiver) {
        createOffer();
    }
});

socket.on('message', handleSignalingMessage);

// Initialize peer connection
function initPeerConnection(isSender) {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('message', JSON.stringify({ candidate: e.candidate }));
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
            console.log('Peers connected!');
            if (isSender) {
                sendFile();
            }
        }
    };

    if (isSender) {
        // Create data channel for sending files
        sendChannel = pc.createDataChannel('sendDataChannel');
        sendChannel.onopen = handleSendChannelStatusChange;
        sendChannel.onclose = handleSendChannelStatusChange;
        sendChannel.onbufferedamountlow = () => {
            if (sendOffset < fileSize) {
                sendChunk();
            }
        };
    } else {
        // Set up the receiving channel
        pc.ondatachannel = receiveChannelCallback;
    }

    if (!isSender) {
        socket.emit('ready');
    }
}

// Create an offer for the peer connection
function createOffer() {
    pc.createOffer()
        .then(setAndSendLocalDescription)
        .catch(errorHandler);
}

// Handle incoming signaling messages
function handleSignalingMessage(message) {
    const msg = JSON.parse(message);
    if (msg.sdp) {
        pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
            .then(() => {
                if (pc.remoteDescription.type === 'offer') {
                    pc.createAnswer()
                        .then(setAndSendLocalDescription)
                        .catch(errorHandler);
                }
            })
            .catch(errorHandler);
    } else if (msg.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(errorHandler);
    }
}

// Set and send local description
function setAndSendLocalDescription(sessionDescription) {
    pc.setLocalDescription(sessionDescription)
        .then(() => {
            socket.emit('message', JSON.stringify({ sdp: sessionDescription }));
        })
        .catch(errorHandler);
}

// Handle send channel status change
function handleSendChannelStatusChange() {
    if (sendChannel && sendChannel.readyState === 'open') {
        sendFile();
    }
}

// Set up the receive channel callback
function receiveChannelCallback(event) {
    receiveChannel = event.channel;
    receiveChannel.binaryType = 'arraybuffer';
    receiveChannel.onmessage = handleReceiveMessage;
    receiveChannel.onopen = handleReceiveChannelStatusChange;
    receiveChannel.onclose = handleReceiveChannelStatusChange;
}

// Handle receive channel status change
function handleReceiveChannelStatusChange() {
    if (receiveChannel && receiveChannel.readyState === 'open') {
        status.textContent = 'Connected to peer. Waiting for file...';
    }
}

// Variables for received file
let receivedSize = 0;
let receivedBuffers = [];

// Handle incoming messages on the receive channel
function handleReceiveMessage(event) {
    if (typeof event.data === 'string') {
        // Handle metadata
        const metadata = JSON.parse(event.data);
        fileName = metadata.fileName;
        fileSize = metadata.fileSize;
        receiverStatusMessage.textContent = `Receiving ${fileName}...`;

        // Show progress container
        receiverProgressContainer.style.display = 'block';
        receiverProgressBar.style.width = '0%';
        receiverProgressBar.setAttribute('aria-valuenow', 0);

        // Initialize received buffers and size
        receivedBuffers = [];
        receivedSize = 0;

    } else {
        // Handle binary data (file chunks)
        receivedBuffers.push(event.data);
        receivedSize += event.data.byteLength;

        // Update progress
        updateProgress(receivedSize, fileSize);
    }
}

// Update progress for the receiver
function updateProgress(receivedSize, fileSize) {
    const progress = Math.round((receivedSize / fileSize) * 100);
    receiverStatusMessage.textContent = `Receiving ${fileName}... ${progress}%`;
    receiverProgressBar.style.width = `${progress}%`;
    receiverProgressBar.setAttribute('aria-valuenow', progress);

    if (receivedSize === fileSize) {
        const receivedBlob = new Blob(receivedBuffers, { type: 'application/octet-stream' });
        const downloadUrl = URL.createObjectURL(receivedBlob);
        prepareDownload(downloadUrl, fileName);
    }
}

// Prepare download after file transfer
function prepareDownload(downloadUrl, fileName) {
    downloadButton.href = downloadUrl;
    downloadButton.download = fileName;
    downloadButton.style.display = 'block';
    receiverStatusMessage.textContent = `${fileName} is ready for download!`;

    downloadButton.onclick = () => {
        downloadFile(downloadUrl, fileName);
        URL.revokeObjectURL(downloadUrl); // Clean up
    };

    // Hide progress container after download
    receiverProgressContainer.style.display = 'none'; 
}

// Download the file
function downloadFile(downloadUrl, fileName) {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = downloadUrl;
    a.download = fileName;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a); // Clean up
}

// Send the file
function sendFile() {
    sendOffset = 0; // Reset offset
    sendChannel.send(JSON.stringify({ fileName, fileSize }));
    sendChunk();
}

// Send file chunks
function sendChunk() {
    if (sendChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        return; // Wait if buffer is full
    }

    const slice = fileToSend.slice(sendOffset, sendOffset + CHUNK_SIZE);
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
        sendChannel.send(e.target.result);
        sendOffset += e.target.result.byteLength;

        // Update progress
        const progress = Math.round((sendOffset / fileSize) * 100);
        document.getElementById('progressBar').style.width = progress + '%';
        status.textContent = `Sending ${fileName}... ${progress}%`;

        if (sendOffset < fileSize) {
            sendChunk(); // Send next chunk
        } else {
            status.textContent = `${fileName} sent successfully!`;
        }
    };

    fileReader.onerror = () => {
        status.textContent = 'An error occurred while reading the file. Please try again.';
    };

    fileReader.readAsArrayBuffer(slice);
}

// Error handler for signaling
function errorHandler(error) {
    console.error('Error:', error);
    status.textContent = 'An error occurred during file transfer.';
}
