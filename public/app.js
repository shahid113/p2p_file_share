const socket = io();
let pc;
let sendChannel;
let receiveChannel;
let fileToSend;
let fileName;
let fileSize;
let sendOffset = 0;
const CHUNK_SIZE = 65536;  // 64KB chunk size for better performance
const MAX_BUFFERED_AMOUNT = 262144; // 256KB WebRTC buffer size limit

const senderUI = document.getElementById('senderUI');
const receiverUI = document.getElementById('receiverUI');
const fileInput = document.getElementById('fileInput');
const selectFile = document.getElementById('selectFile');
const shareLink = document.getElementById('shareLink');
const status = document.getElementById('status');
const downloadButton = document.getElementById('downloadButton');

// Check if we're the receiver
const isReceiver = window.location.hash.substring(1);

if (isReceiver) {
    senderUI.style.display = 'none';
    receiverUI.style.display = 'block';
    socket.emit('join', isReceiver);
} else {
    selectFile.onclick = () => fileInput.click();
    fileInput.onchange = handleFileInputChange;
}

function handleFileInputChange() {
    fileToSend = fileInput.files[0];
    fileName = fileToSend.name;
    fileSize = fileToSend.size;
    socket.emit('create');
}

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

function initPeerConnection(isSender) {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('message', JSON.stringify({ 'candidate': e.candidate }));
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
        sendChannel = pc.createDataChannel('sendDataChannel');
        sendChannel.onopen = handleSendChannelStatusChange;
        sendChannel.onclose = handleSendChannelStatusChange;
        sendChannel.onbufferedamountlow = () => {
            if (sendOffset < fileSize) {
                sendChunk();
            }
        };
    } else {
        pc.ondatachannel = receiveChannelCallback;
    }

    if (!isSender) {
        socket.emit('ready');
    }
}

function createOffer() {
    pc.createOffer().then(setAndSendLocalDescription).catch(errorHandler);
}

function handleSignalingMessage(message) {
    const msg = JSON.parse(message);

    if (msg.sdp) {
        pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
            .then(() => {
                if (pc.remoteDescription.type === 'offer') {
                    pc.createAnswer().then(setAndSendLocalDescription).catch(errorHandler);
                }
            })
            .catch(errorHandler);
    } else if (msg.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(errorHandler);
    }
}

function setAndSendLocalDescription(sessionDescription) {
    pc.setLocalDescription(sessionDescription)
        .then(() => {
            socket.emit('message', JSON.stringify({ 'sdp': sessionDescription }));
        })
        .catch(errorHandler);
}

function handleSendChannelStatusChange() {
    if (sendChannel && sendChannel.readyState === 'open') {
        sendFile();
    }
}

function receiveChannelCallback(event) {
    receiveChannel = event.channel;
    receiveChannel.binaryType = 'arraybuffer';
    receiveChannel.onmessage = handleReceiveMessage;
    receiveChannel.onopen = handleReceiveChannelStatusChange;
    receiveChannel.onclose = handleReceiveChannelStatusChange;
}

function handleReceiveChannelStatusChange() {
    if (receiveChannel && receiveChannel.readyState === 'open') {
        status.textContent = 'Connected to peer. Waiting for file...';
    }
}

let receivedSize = 0;
let receivedBuffers = [];

function handleReceiveMessage(event) {
    if (typeof event.data === 'string') {
        // Handle metadata
        const metadata = JSON.parse(event.data);
        fileName = metadata.fileName;
        fileSize = metadata.fileSize;
        status.textContent = `Receiving ${fileName}...`;
        downloadButton.style.display = 'none';
    } else {
        // Handle binary data (file chunks)
        receivedBuffers.push(event.data);
        receivedSize += event.data.byteLength;

        // Update progress
        const progress = Math.round((receivedSize / fileSize) * 100);
        status.textContent = `Receiving ${fileName}... ${progress}%`;

        if (receivedSize === fileSize) {
            const receivedBlob = new Blob(receivedBuffers, { type: 'application/octet-stream' });
            const downloadUrl = URL.createObjectURL(receivedBlob);

            // Validate file integrity by checking received size
            if (receivedSize === fileSize) {
                downloadButton.href = downloadUrl;
                downloadButton.download = fileName;
                downloadButton.style.display = 'block';
                status.textContent = `${fileName} is ready for download!`;

                downloadButton.onclick = () => {
                    downloadFile(downloadUrl, fileName);
                    URL.revokeObjectURL(downloadUrl); // Clean up
                    status.textContent = 'File downloaded successfully!';
                };

                receivedBuffers = []; // Clear buffer after download
            } else {
                status.textContent = 'File transfer error: Incomplete file received.';
            }

            receivedSize = 0; // Reset for next file
        }
    }
}

function downloadFile(downloadUrl, fileName) {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = downloadUrl;
    a.download = fileName;
    
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a); // Clean up
}

function sendFile() {
    sendOffset = 0; // Reset offset
    sendChannel.send(JSON.stringify({ fileName: fileName, fileSize: fileSize }));
    sendChunk();
}

function sendChunk() {
    if (sendChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        return;  // Wait if buffer is full
    }

    const slice = fileToSend.slice(sendOffset, sendOffset + CHUNK_SIZE);
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
        sendChannel.send(e.target.result);
        sendOffset += e.target.result.byteLength;

        // Update progress
        const progress = Math.round((sendOffset / fileSize) * 100);
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

if (isReceiver) {
    downloadButton.addEventListener('click', () => {
        status.textContent = 'File downloaded successfully!';
    });
}


function errorHandler(error) {
    console.error('Error:', error);
    status.textContent = 'An error occurred. Please try again.';
}
