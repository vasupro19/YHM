class Notification {
    #io;

    constructor(io) {
        this.#io = io;
    }

    sendToRoom(room, data) {
        this.#io.to(room).emit(data);
        io.emit(room, data);
        return;
    }
    broadcast(data) {
        this.#io.to('notification').emit(data);
        return;
    }
}

function initNotification(io) {
    return new Notification(io);
}

module.exports = initNotification;
