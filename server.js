const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    socket.on('create', () => {
        const roomId = generateRoomId();
        socket.join(roomId);
        socket.emit('created', roomId);
    });

    socket.on('join', (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        if (room && room.size === 1) {
            socket.join(roomId);
            socket.to(roomId).emit('ready');
            socket.emit('joined');
        } else {
            socket.emit('full');
        }
    });

    socket.on('message', (message) => {
        socket.to(Array.from(socket.rooms)[1]).emit('message', message);
    });

    socket.on('ready', () => {
        socket.to(Array.from(socket.rooms)[1]).emit('ready');
    });
});

function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});