const sendNotification = async (source, data) => {
    try {
        if (!source || !source instanceof String) new Error(!source ? 'Expected emit source got null | undefined' : !source instanceof String ? `Expected String got ${typeof source}` : 'Unexpected error')
        io.emit(source, data);
        return true;
    } catch (error) {
        return error;
    }
}

module.exports = { sendNotification };