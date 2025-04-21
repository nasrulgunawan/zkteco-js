/**
 *
 * Author: coding-libs
 * Date: 2024-07-01
 */

const ZTCP = require('./src/ztcp')
const ZUDP = require('./src/zudp')

const {ZkError, ERROR_TYPES} = require('./src/exceptions/handler')

class ZktecoJs {
    constructor(ip, port, timeout, inport) {
        this.connectionType = null

        this.ztcp = new ZTCP(ip, port, timeout)
        this.zudp = new ZUDP(ip, port, timeout, inport)
        this.interval = null
        this.timer = null
        this.isBusy = false
        this.ip = ip
    }

    async functionWrapper(tcpCallback, udpCallback, command) {
        try {
            switch (this.connectionType) {
                case 'tcp':
                    if (this.ztcp && this.ztcp.socket) {
                        return await tcpCallback();
                    } else {
                        throw new ZkError(
                            new Error(`TCP socket isn't connected!`),
                            `[TCP] ${command}`,
                            this.ip
                        );
                    }

                case 'udp':
                    if (this.zudp && this.zudp.socket) {
                        return await udpCallback();
                    } else {
                        throw new ZkError(
                            new Error(`UDP socket isn't connected!`),
                            `[UDP] ${command}`,
                            this.ip
                        );
                    }

                default:
                    throw new ZkError(
                        new Error(`Unsupported connection type or socket isn't connected!`),
                        '',
                        this.ip
                    );
            }
        } catch (err) {
            // Wrap the error in a ZkError and include context
            throw new ZkError(
                err,
                `[${this.connectionType.toUpperCase()}] ${command}`,
                this.ip
            );
        }
    }

    async createSocket(cbErr, cbClose) {
        try {
            if (this.ztcp.socket) {
                // If TCP socket already exists, try to connect
                try {
                    await this.ztcp.connect();
                    console.log('TCP reconnection successful');
                    this.connectionType = 'tcp';
                    return true; // Return true if TCP connection is successful
                } catch (err) {
                    throw new ZkError(err, 'TCP CONNECT', this.ip);
                }
            } else {
                // Attempt to create and connect TCP socket
                try {
                    await this.ztcp.createSocket(cbErr, cbClose);

                    // Get password from environment variable or configuration
                    const password = process.env.ZKTECO_PASSWORD || '';
                    if (!password) {
                        throw new Error('ZKTECO_PASSWORD environment variable is not set');
                    }

                    await this.ztcp.connectWithAuth(password);
                    console.log('TCP connection successful');
                    this.connectionType = 'tcp';
                    return true; // Return true if TCP connection is successful
                } catch (err) {
                    throw new ZkError(err, 'TCP CONNECT', this.ip);
                }
            }
        } catch (err) {
            throw new ZkError(err, 'SOCKET_CREATE', this.ip);
        }
    }


    async getUsers() {
        return await this.functionWrapper(
            () => this.ztcp.getUsers(),
            () => this.zudp.getUsers()
        )
    }

    async getTime() {
        return await this.functionWrapper(
            () => this.ztcp.getTime(),
            () => this.zudp.getTime()
        )
    }

    async setTime(t) {
        return await this.functionWrapper(
            () => this.ztcp.setTime(t),
            () => this.zudp.setTime(t)
        )
    }

    async voiceTest() {
        return await this.functionWrapper(
            () => this.ztcp.voiceTest()
        )
    }

    async getProductTime() {
        return await this.functionWrapper(
            () => this.ztcp.getProductTime()
        )
    }

    async getVendor() {
        return await this.functionWrapper(
            () => this.ztcp.getVendor()
        )
    }

    async getMacAddress() {
        return await this.functionWrapper(
            () => this.ztcp.getMacAddress()
        )
    }

    async getSerialNumber() {
        return await this.functionWrapper(
            () => this.ztcp.getSerialNumber()
        )
    }

    async getDeviceVersion() {
        return await this.functionWrapper(
            () => this.ztcp.getDeviceVersion()
        )
    }

    async getDeviceName() {
        return await this.functionWrapper(
            () => this.ztcp.getDeviceName()
        )
    }

    async getPlatform() {
        return await this.functionWrapper(
            () => this.ztcp.getPlatform()
        )
    }

    async getOS() {
        return await this.functionWrapper(
            () => this.ztcp.getOS()
        )
    }

    async getWorkCode() {
        return await this.functionWrapper(
            () => this.ztcp.getWorkCode()
        )
    }

    async getPIN() {
        return await this.functionWrapper(
            () => this.ztcp.getPIN()
        )
    }

    async getFaceOn() {
        return await this.functionWrapper(
            () => this.ztcp.getFaceOn()
        )
    }

    async getSSR() {
        return await this.functionWrapper(
            () => this.ztcp.getSSR()
        )
    }

    async getFirmware() {
        return await this.functionWrapper(
            () => this.ztcp.getFirmware()
        )
    }

    async setUser(uid, userid, name, password = '', role = 0, cardno = 0, faceTemplate = null) {
        return await this.functionWrapper(
            () => this.ztcp.setUser(uid, userid, name, password, role, cardno, faceTemplate)
        )
    }

    async deleteUser(uid) {
        return await this.functionWrapper(
            () => this.ztcp.deleteUser(uid)
        )
    }

    async getAttendanceSize() {
        return await this.functionWrapper(
            () => this.ztcp.getAttendanceSize()
        )
    }

    async getAttendances(cb) {
        return await this.functionWrapper(
            () => this.ztcp.getAttendances(cb),
            () => this.zudp.getAttendances(cb),
        )
    }

    async getRealTimeLogs(cb) {
        return await this.functionWrapper(
            () => this.ztcp.getRealTimeLogs(cb),
            () => this.zudp.getRealTimeLogs(cb)
        )
    }

    async disconnect() {
        return await this.functionWrapper(
            () => this.ztcp.disconnect(),
            () => this.zudp.disconnect()
        )
    }

    async connect() {
        return await this.functionWrapper(
            () => this.ztcp.connect(),
            () => this.zudp.connect()
        )
    }

    async freeData() {
        return await this.functionWrapper(
            () => this.ztcp.freeData(),
            () => this.zudp.freeData()
        )
    }


    async disableDevice() {
        return await this.functionWrapper(
            () => this.ztcp.disableDevice(),
            () => this.zudp.disableDevice()
        )
    }

    async readAllTemplates() {
        return await this.functionWrapper(
            () => this.ztcp.readAllTemplates(),
            () => this.zudp.readAllTemplates()
        )
    }


    async getFingerprintTemplate(userSn, fingerIndex) {
        return await this.functionWrapper(
            () => this.ztcp.getFingerprintTemplate(userSn, fingerIndex),
            () => this.zudp.getFingerprintTemplate(userSn, fingerIndex)
        )
    }

    async uploadFingerprintTemplate(userSn, fingerIndex, template) {
        return await this.functionWrapper(
            () => this.ztcp.uploadFingerprintTemplate(userSn, fingerIndex, template),
            () => this.zudp.uploadFingerprintTemplate(userSn, fingerIndex, template)
        )
    }

    async enableDevice() {
        return await this.functionWrapper(
            () => this.ztcp.enableDevice(),
            () => this.zudp.enableDevice()
        )
    }


    async getInfo() {
        return await this.functionWrapper(
            () => this.ztcp.getInfo(),
            () => this.zudp.getInfo()
        )
    }


    async getSocketStatus() {
        return await this.functionWrapper(
            () => this.ztcp.getSocketStatus(),
            () => this.zudp.getSocketStatus()
        )
    }

    async clearAttendanceLog() {
        return await this.functionWrapper(
            () => this.ztcp.clearAttendanceLog(),
            () => this.zudp.clearAttendanceLog()
        )
    }

    async clearData() {
        return await this.functionWrapper(
            () => this.ztcp.clearData(),
            () => this.zudp.clearData()
        )
    }

    async executeCmd(command, data = '') {
        return await this.functionWrapper(
            () => this.ztcp.executeCmd(command, data),
            () => this.zudp.executeCmd(command, data)
        )
    }

    setIntervalSchedule(cb, timer) {
        this.interval = setInterval(cb, timer)
    }


    setTimerSchedule(cb, timer) {
        this.timer = setTimeout(cb, timer)
    }

    async restart() {
        return await this.functionWrapper(
            () => this.ztcp.restart(),
            () => this.zudp.restart()
        )
    }

    async captureImage() {
        return await this.functionWrapper(
            () => this.ztcp.captureImage(),
            () => this.zudp.captureImage()
        )
    }

    // async enrollUser(userId, name, password = '', role = 0, cardno = 0) {
    //     return await this.functionWrapper(
    //         () => this.ztcp.enrollUser(userId, name, password, role, cardno),
    //         () => this.zudp.enrollUser(userId, name, password, role, cardno),
    //         'ENROLL_USER'
    //     )
    // }

    async getRealTimeLogs(callback) {
        return await this.functionWrapper(
            () => this.ztcp.getRealTimeLogs(callback),
            () => this.zudp.getRealTimeLogs(callback),
            'GET_REAL_TIME_LOGS'
        )
    }

    async registerFace(userId) {
        return await this.functionWrapper(
            () => this.ztcp.registerFace(userId),
            () => this.zudp.registerFace(userId)
        )
    }

    async clearAttendanceLog() {
        return await this.functionWrapper(
            () => this.ztcp.clearAttendanceLog(),
            () => this.zudp.clearAttendanceLog()
        )
    }

    async disconnect() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.connectionType === 'tcp' && this.ztcp && this.ztcp.socket) {
            this.ztcp.socket.end();
            this.ztcp.socket = null;
        } else if (this.connectionType === 'udp' && this.zudp && this.zudp.socket) {
            this.zudp.socket.close();
            this.zudp.socket = null;
        }

        this.connectionType = null;
        return true;
    }
}


module.exports = ZktecoJs




