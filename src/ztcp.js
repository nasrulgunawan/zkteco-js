/**
 *
 * Author: coding-libs
 * Date: 2024-07-01
 */


const net = require('net')
const {MAX_CHUNK, COMMANDS, REQUEST_DATA} = require('./helper/command')
const timeParser = require('./helper/time');

const {
    createTCPHeader,
    exportErrorMessage,
    removeTcpHeader,
    decodeUserData72,
    decodeRecordData40,
    decodeRecordRealTimeLog52,
    checkNotEventTCP,
    decodeTCPHeader
} = require('./helper/utils')

const {log} = require('./logs/log')
const {error} = require('console')

class ZTCP {
    constructor(ip, port, timeout) {
        this.ip = ip;
        this.port = port;
        this.timeout = timeout;
        this.sessionId = null;
        this.replyId = 0;
        this.socket = null;
    }

    createSocket(cbError, cbClose) {
        return new Promise((resolve, reject) => {
            this.socket = new net.Socket();

            // Handle socket error
            this.socket.once('error', (err) => {
                this.socket = null; // Ensure socket reference is cleared
                reject(err);
                if (typeof cbError === 'function') cbError(err);
            });

            // Handle successful connection
            this.socket.once('connect', () => {
                resolve(this.socket);
            });

            // Handle socket closure
            this.socket.once('close', () => {
                this.socket = null; // Ensure socket reference is cleared
                if (typeof cbClose === 'function') cbClose('tcp');
            });

            // Set socket timeout if provided
            if (this.timeout) {
                this.socket.setTimeout(this.timeout);
            }

            // Initiate connection
            this.socket.connect(this.port, this.ip);
        });
    }

    async connect() {
        try {
            const reply = await this.executeCmd(COMMANDS.CMD_CONNECT, '');
            if (reply) {
                console.log('Connection successful', reply);
                // Connection successful
                return true;
            } else {
                // No reply received; throw an error
                throw new Error('NO_REPLY_ON_CMD_CONNECT');
            }
        } catch (err) {
            // Log the error for debugging, if necessary
            console.error('Failed to connect:', err);
            // Re-throw the error for handling by the caller
            throw err;
        }
    }

    async connectWithAuth(password) {
        try {
            // Reset session and reply IDs
            this.sessionId = 0;
            this.replyId = 0;

            // First establish a connection
            await this.connect();

            // Hash the password using SHA-256
            const crypto = require('crypto');
            const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

            // Create a buffer for the hashed password with proper length
            const passwordBuffer = Buffer.alloc(64); // SHA-256 produces 64 hex characters
            passwordBuffer.write(hashedPassword, 0);

            // Add a timestamp to prevent replay attacks
            const timestamp = Buffer.alloc(8);
            timestamp.writeBigInt64LE(BigInt(Date.now()), 0);

            // Combine password and timestamp
            const authBuffer = Buffer.concat([passwordBuffer, timestamp]);

            // Send authentication command with hashed password and timestamp
            const reply = await this.executeCmd(COMMANDS.CMD_AUTH, authBuffer);

            if (reply) {
                // Verify the response integrity
                if (reply.length < 6) {
                    throw new Error('INVALID_AUTH_RESPONSE');
                }

                // Extract and verify session ID
                const receivedSessionId = reply.readUInt16LE(4);
                if (receivedSessionId === 0) {
                    throw new Error('INVALID_SESSION_ID');
                }

                // Store the session ID
                this.sessionId = receivedSessionId;

                // Store the authentication timestamp for session validation
                this.authTimestamp = Date.now();

                return true;
            } else {
                throw new Error('NO_REPLY_ON_CMD_AUTH');
            }
        } catch (err) {
            console.error('Failed to authenticate:', err);
            throw err;
        }
    }

    async closeSocket() {
        return new Promise((resolve, reject) => {
            // If no socket is present, resolve immediately
            if (!this.socket) {
                return resolve(true);
            }

            // Clean up listeners to avoid potential memory leaks or duplicate handling
            this.socket.removeAllListeners('data');

            // Set a timeout to handle cases where socket.end might not resolve
            const timer = setTimeout(() => {
                this.socket.destroy(); // Forcibly close the socket if not closed properly
                resolve(true); // Resolve even if the socket was not closed properly
            }, 2000);

            // Close the socket and clear the timeout upon successful completion
            this.socket.end(() => {
                clearTimeout(timer);
                resolve(true); // Resolve once the socket has ended
            });

            // Handle socket errors during closing
            this.socket.once('error', (err) => {
                clearTimeout(timer);
                reject(err); // Reject the promise with the error
            });
        });
    }

    writeMessage(msg, connect) {
        return new Promise((resolve, reject) => {
            // Check if the socket is initialized
            if (!this.socket) {
                return reject(new Error('Socket is not initialized'));
            }

            // Define a variable for the timeout reference
            let timer = null;

            // Handle incoming data
            const onData = (data) => {
                // Check if the socket is still valid before trying to remove the listener
                if (this.socket) {
                    this.socket.removeListener('data', onData); // Remove the data event listener
                }
                clearTimeout(timer); // Clear the timeout once data is received
                resolve(data); // Resolve the promise with the received data
            };

            // Attach the data event listener
            this.socket.once('data', onData);

            // Attempt to write the message to the socket
            this.socket.write(msg, null, (err) => {
                if (err) {
                    // Check if the socket is still valid before trying to remove the listener
                    if (this.socket) {
                        this.socket.removeListener('data', onData); // Clean up listener on write error
                    }
                    return reject(err); // Reject the promise with the write error
                }

                // If a timeout is set, configure it
                if (this.timeout) {
                    timer = setTimeout(() => {
                        // Check if the socket is still valid before trying to remove the listener
                        if (this.socket) {
                            this.socket.removeListener('data', onData); // Remove listener on timeout
                        }
                        reject(new Error('TIMEOUT_ON_WRITING_MESSAGE')); // Reject the promise on timeout
                    }, connect ? 2000 : this.timeout);
                }
            });
        });
    }


    requestData(msg) {
        return new Promise((resolve, reject) => {
            let timer = null;
            let replyBuffer = Buffer.from([]);

            // Internal callback to handle data reception
            const internalCallback = (data) => {
                if (this.socket) {
                    this.socket.removeListener('data', handleOnData); // Clean up listener
                }
                if (timer) clearTimeout(timer); // Clear the timeout
                resolve(data); // Resolve the promise with the data
            };

            // Handle incoming data
            const handleOnData = (data) => {
                replyBuffer = Buffer.concat([replyBuffer, data]); // Accumulate data

                // Check if the data is a valid TCP event
                if (checkNotEventTCP(data)) return;

                // Decode the TCP header
                const header = decodeTCPHeader(replyBuffer.subarray(0, 16));

                // Handle based on command ID
                if (header.commandId === COMMANDS.CMD_DATA) {
                    // Set a timeout to handle delayed responses
                    timer = setTimeout(() => {
                        internalCallback(replyBuffer); // Resolve with accumulated buffer
                    }, 1000);
                } else {
                    // Set a timeout to handle errors
                    timer = setTimeout(() => {
                        if (this.socket) {
                            this.socket.removeListener('data', handleOnData); // Clean up listener on timeout
                        }
                        reject(new Error('TIMEOUT_ON_RECEIVING_REQUEST_DATA')); // Reject on timeout
                    }, this.timeout);

                    // Extract packet length and handle accordingly
                    const packetLength = data.readUIntLE(4, 2);
                    if (packetLength > 8) {
                        internalCallback(data); // Resolve immediately if sufficient data
                    }
                }
            };

            // Ensure the socket is valid before attaching the listener
            if (this.socket) {
                this.socket.on('data', handleOnData);

                // Write the message to the socket
                this.socket.write(msg, null, (err) => {
                    if (err) {
                        if (this.socket) {
                            this.socket.removeListener('data', handleOnData); // Clean up listener on error
                        }
                        return reject(err); // Reject the promise with the error
                    }

                    // Set a timeout to handle cases where no response is received
                    timer = setTimeout(() => {
                        if (this.socket) {
                            this.socket.removeListener('data', handleOnData); // Clean up listener on timeout
                        }
                        reject(new Error('TIMEOUT_IN_RECEIVING_RESPONSE_AFTER_REQUESTING_DATA')); // Reject on timeout
                    }, this.timeout);
                });
            } else {
                reject(new Error('SOCKET_NOT_INITIALIZED')); // Reject if socket is not initialized
            }
        }).catch((err) => {
            console.error("Promise Rejected:", err); // Log the rejection reason
            throw err; // Re-throw the error to be handled by the caller
        });
    }


    /**
     *
     * @param {*} command
     * @param {*} data
     *
     *
     * reject error when command fail and resolve data when success
     */

    async executeCmd(command, data) {
        // Reset sessionId and replyId for connection commands
        if (command === COMMANDS.CMD_CONNECT) {
            this.sessionId = 0;
            this.replyId = 0;
        } else {
            this.replyId++;
        }

        const buf = createTCPHeader(command, this.sessionId, this.replyId, data);

        try {
            // Write the message to the socket and wait for a response
            const reply = await this.writeMessage(buf, command === COMMANDS.CMD_CONNECT || command === COMMANDS.CMD_EXIT);

            // Remove TCP header from the response
            const rReply = removeTcpHeader(reply);

            // Update sessionId for connection command responses
            if (command === COMMANDS.CMD_CONNECT && rReply && rReply.length >= 6) { // Assuming sessionId is located at offset 4 and is 2 bytes long
                this.sessionId = rReply.readUInt16LE(4);
            }

            return rReply;
        } catch (err) {
            // Log or handle the error if necessary
            console.error('Error executing command:', err);
            throw err; // Re-throw the error for handling by the caller
        }
    }

    async sendChunkRequest(start, size) {
        this.replyId++;
        const reqData = Buffer.alloc(8);
        reqData.writeUInt32LE(start, 0);
        reqData.writeUInt32LE(size, 4);
        const buf = createTCPHeader(COMMANDS.CMD_DATA_RDY, this.sessionId, this.replyId, reqData);

        try {
            await new Promise((resolve, reject) => {
                this.socket.write(buf, null, (err) => {
                    if (err) {
                        console.error(`[TCP][SEND_CHUNK_REQUEST] Error sending chunk request: ${err.message}`);
                        reject(err); // Reject the promise if there is an error
                    } else {
                        resolve(); // Resolve the promise if the write operation succeeds
                    }
                });
            });
        } catch (err) {
            // Handle or log the error as needed
            console.error(`[TCP][SEND_CHUNK_REQUEST] Exception: ${err.message}`);
            throw err; // Re-throw the error for handling by the caller
        }
    }


    /**
     *
     * @param {*} reqData - indicate the type of data that need to receive ( user or attLog)
     * @param {*} cb - callback is triggered when receiving packets
     *
     * readWithBuffer will reject error if it'wrong when starting request data
     * readWithBuffer will return { data: replyData , err: Error } when receiving requested data
     */
    readWithBuffer(reqData, cb = null) {
        return new Promise(async (resolve, reject) => {

            this.replyId++;
            const buf = createTCPHeader(COMMANDS.CMD_DATA_WRRQ, this.sessionId, this.replyId, reqData)
            let reply = null;

            try {
                reply = await this.requestData(buf)
                //console.log(reply.toString('hex'));

            } catch (err) {
                reject(err)
                console.log(reply)

            }

            const header = decodeTCPHeader(reply.subarray(0, 16))
            switch (header.commandId) {
                case COMMANDS.CMD_DATA: {
                    resolve({data: reply.subarray(16), mode: 8})
                    break;
                }
                case COMMANDS.CMD_ACK_OK:
                case COMMANDS.CMD_PREPARE_DATA: {
                    // this case show that data is prepared => send command to get these data
                    // reply variable includes information about the size of following data
                    const recvData = reply.subarray(16)
                    const size = recvData.readUIntLE(1, 4)


                    // We need to split the data to many chunks to receive , because it's to large
                    // After receiving all chunk data , we concat it to TotalBuffer variable , that 's the data we want
                    let remain = size % MAX_CHUNK
                    let numberChunks = Math.round(size - remain) / MAX_CHUNK
                    let totalPackets = numberChunks + (remain > 0 ? 1 : 0)
                    let replyData = Buffer.from([])


                    let totalBuffer = Buffer.from([])
                    let realTotalBuffer = Buffer.from([])


                    const timeout = 10000
                    let timer = setTimeout(() => {
                        internalCallback(replyData, new Error('TIMEOUT WHEN RECEIVING PACKET'))
                    }, timeout)


                    const internalCallback = (replyData, err = null) => {
                        // this.socket && this.socket.removeListener('data', handleOnData)
                        timer && clearTimeout(timer)
                        resolve({data: replyData, err})

                    }


                    const handleOnData = (reply) => {

                        if (checkNotEventTCP(reply)) return;
                        clearTimeout(timer)
                        timer = setTimeout(() => {
                            internalCallback(replyData,
                                new Error(`TIME OUT !! ${totalPackets} PACKETS REMAIN !`))
                        }, timeout)

                        totalBuffer = Buffer.concat([totalBuffer, reply])
                        const packetLength = totalBuffer.readUIntLE(4, 2)
                        if (totalBuffer.length >= 8 + packetLength) {

                            realTotalBuffer = Buffer.concat([realTotalBuffer, totalBuffer.subarray(16, 8 + packetLength)])
                            totalBuffer = totalBuffer.subarray(8 + packetLength)

                            if ((totalPackets > 1 && realTotalBuffer.length === MAX_CHUNK + 8)
                                || (totalPackets === 1 && realTotalBuffer.length === remain + 8)) {

                                replyData = Buffer.concat([replyData, realTotalBuffer.subarray(8)])
                                totalBuffer = Buffer.from([])
                                realTotalBuffer = Buffer.from([])

                                totalPackets -= 1
                                cb && cb(replyData.length, size)

                                if (totalPackets <= 0) {
                                    internalCallback(replyData)
                                }
                            }
                        }
                    }

                    this.socket.once('close', () => {
                        internalCallback(replyData, new Error('Socket is disconnected unexpectedly'))
                    })

                    this.socket.on('data', handleOnData);

                    for (let i = 0; i <= numberChunks; i++) {
                        if (i === numberChunks) {
                            this.sendChunkRequest(numberChunks * MAX_CHUNK, remain)
                        } else {
                            this.sendChunkRequest(i * MAX_CHUNK, MAX_CHUNK)
                        }
                    }

                    break;
                }
                default: {
                    reject(new Error('ERROR_IN_UNHANDLE_CMD ' + exportErrorMessage(header.commandId)))
                }
            }
        })
    }

    /**
     *  reject error when starting request data
     *  return { data: users, err: Error } when receiving requested data
     */
    async getUsers() {
        try {
            // Free any existing buffer data to prepare for a new request
            if (this.socket) {
                await this.freeData();
            }

            // Request user data
            const data = await this.readWithBuffer(REQUEST_DATA.GET_USERS);

            // Free buffer data after receiving the data
            if (this.socket) {
                await this.freeData();
            }

            // Constants for user data processing
            const USER_PACKET_SIZE = 72;

            // Ensure data.data is a valid buffer
            if (!data.data || !(data.data instanceof Buffer)) {
                throw new Error('Invalid data received');
            }

            let userData = data.data.subarray(4); // Skip the first 4 bytes (headers)
            const users = [];

            // Process each user packet
            while (userData.length >= USER_PACKET_SIZE) {
                // Decode user data and add to the users array
                const user = decodeUserData72(userData.subarray(0, USER_PACKET_SIZE));
                users.push(user);
                userData = userData.subarray(USER_PACKET_SIZE); // Move to the next packet
            }

            // Return the list of users
            return { data: users };

        } catch (err) {
            // Log the error for debugging
            console.error('Error getting users:', err);
            // Re-throw the error to be handled by the caller
            throw err;
        }
    }


    /**
     *
     * @param {*} ip
     * @param {*} callbackInProcess
     *  reject error when starting request data
     *  return { data: records, err: Error } when receiving requested data
     */

    async getAttendances(callbackInProcess = () => {}) {
        try {
            // Free any existing buffer data to prepare for a new request
            if (this.socket) {
                await this.freeData();
            }

            // Request attendance logs and handle chunked data
            const data = await this.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS, callbackInProcess);

            // Free buffer data after receiving the attendance logs
            if (this.socket) {
                await this.freeData();
            }

            // Constants for record processing
            const RECORD_PACKET_SIZE = 40;

            // Ensure data.data is a valid buffer
            if (!data.data || !(data.data instanceof Buffer)) {
                throw new Error('Invalid data received');
            }

            // Process the record data
            let recordData = data.data.subarray(4); // Skip header
            const records = [];

            // Process each attendance record
            while (recordData.length >= RECORD_PACKET_SIZE) {
                const record = decodeRecordData40(recordData.subarray(0, RECORD_PACKET_SIZE));
                records.push({ ...record, ip: this.ip }); // Add IP address to each record
                recordData = recordData.subarray(RECORD_PACKET_SIZE); // Move to the next packet
            }

            // Return the list of attendance records
            return { data: records };

        } catch (err) {
            // Log and re-throw the error
            console.error('Error getting attendance records:', err);
            throw err; // Re-throw the error for handling by the caller
        }
    }

    async freeData() {
        try {
            return await this.executeCmd(COMMANDS.CMD_FREE_DATA, '');
        } catch (err) {
            console.error('Error freeing data:', err);
            throw err;  // Optionally, re-throw the error if you need to handle it upstream
        }
    }

    async disableDevice() {
        try {
            return await this.executeCmd(COMMANDS.CMD_DISABLEDEVICE, REQUEST_DATA.DISABLE_DEVICE);
        } catch (err) {
            console.error('Error disabling device:', err);
            throw err;  // Optionally, re-throw the error if you need to handle it upstream
        }
    }

    async enableDevice() {
        try {
            return await this.executeCmd(COMMANDS.CMD_ENABLEDEVICE, '');
        } catch (err) {
            console.error('Error enabling device:', err);
            throw err;  // Optionally, re-throw the error if you need to handle it upstream
        }
    }

    async disconnect() {
        try {
            // Attempt to execute the disconnect command
            await this.executeCmd(COMMANDS.CMD_EXIT, '');
        } catch (err) {
            // Log any errors encountered during command execution
            console.error('Error during disconnection:', err);
            // Optionally, add more handling or recovery logic here
        }

        // Attempt to close the socket and return the result
        try {
            return await this.closeSocket();
        } catch (err) {
            // Log any errors encountered while closing the socket
            console.error('Error during socket closure:', err);
            // Optionally, rethrow or handle the error if necessary
            throw err; // Re-throwing to propagate the error
        }
    }


    async getInfo() {
        try {
            // Execute the command to retrieve free sizes from the device
            const data = await this.executeCmd(COMMANDS.CMD_GET_FREE_SIZES, '');

            // Parse the response data to extract and return relevant information
            return {
                userCounts: data.readUIntLE(24, 4), // Number of users
                logCounts: data.readUIntLE(40, 4),  // Number of logs
                logCapacity: data.readUIntLE(72, 4) // Capacity of logs in bytes
            };
        } catch (err) {
            // Log the error for debugging purposes
            console.error('Error getting device info:', err);
            // Re-throw the error to allow upstream error handling
            throw err;
        }
    }


    async getVendor() {
        const keyword = '~OEMVendor';

        try {
            // Execute the command to get serial number
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the serial number from the response data
            const vendor = data.slice(8) // Skip the first 8 bytes (header)
                .toString('ascii')              // Convert buffer to string
                .replace(`${keyword}=`, '')     // Remove the keyword prefix
                .replace(/\u0000/g, '');        // Remove null characters

            return vendor;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting vendor:', err);
            // Re-throw the error for higher-level handling
            throw err;
        }
    }


    async getProductTime() {
        const keyword = '~ProductTime';

        try {
            // Execute the command to get serial number
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the serial number from the response data
            const ProductTime = data.slice(8) // Skip the first 8 bytes (header)
                .toString('ascii')              // Convert buffer to string
                .replace(`${keyword}=`, '')     // Remove the keyword prefix
                .replace(/\u0000/g, '');        // Remove null characters

            return new Date(ProductTime);

        } catch (err) {
            // Log the error for debugging
            console.error('Error getting Product Time:', err);
            // Re-throw the error for higher-level handling
            throw err;
        }
    }

    async getMacAddress() {
        const keyword = 'MAC';

        try {
            // Execute the command to get serial number
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the serial number from the response data
            const macAddr = data.slice(8) // Skip the first 8 bytes (header)
                .toString('ascii')              // Convert buffer to string
                .replace(`${keyword}=`, '')     // Remove the keyword prefix
                .replace(/\u0000/g, '');        // Remove null characters

            return macAddr;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting MAC address:', err);
            // Re-throw the error for higher-level handling
            throw err;
        }
    }


    async getSerialNumber() {
        const keyword = '~SerialNumber';

        try {
            // Execute the command to get serial number
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the serial number from the response data
            const serialNumber = data.slice(8) // Skip the first 8 bytes (header)
                .toString('utf-8')              // Convert buffer to string
                .replace(`${keyword}=`, '')     // Remove the keyword prefix
                .replace(/\u0000/g, '');        // Remove null characters

            return serialNumber;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting serial number:', err);
            // Re-throw the error for higher-level handling
            throw err;
        }
    }


    async getDeviceVersion() {
        const keyword = '~ZKFPVersion';

        try {
            // Execute the command to get device version
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the device version from the response data
            const deviceVersion = data.slice(8)      // Skip the first 8 bytes (header)
                .toString('ascii')                  // Convert buffer to ASCII string
                .replace(`${keyword}=`, '')         // Remove the keyword prefix
                .replace(/\u0000/g, '');            // Remove null characters

            return deviceVersion;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting device version:', err);
            // Re-throw the error for higher-level handling
            throw err;
        }
    }


    async getDeviceName() {
        const keyword = '~DeviceName';

        try {
            // Execute the command to get the device name
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the device name from the response data
            const deviceName = data.slice(8)      // Skip the first 8 bytes (header)
                .toString('ascii')                // Convert buffer to ASCII string
                .replace(`${keyword}=`, '')       // Remove the keyword prefix
                .replace(/\u0000/g, '');          // Remove null characters

            return deviceName;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting device name:', err);
            // Re-throw the error for higher-level handling
            throw err;
        }
    }


    async getPlatform() {
        const keyword = '~Platform';

        try {
            // Execute the command to get the platform information
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the platform information from the response data
            const platform = data.slice(8)              // Skip the first 8 bytes (header)
                .toString('ascii')                    // Convert buffer to ASCII string
                .replace(`${keyword}=`, '')           // Remove the keyword prefix
                .replace(/\u0000/g, '');              // Remove null characters

            return platform;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting platform information:', err);
            // Re-throw the error for higher-level handling
            throw err;
        }
    }


    async getOS() {
        const keyword = '~OS';

        try {
            // Execute the command to get the OS information
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the OS information from the response data
            const osInfo = data.slice(8)              // Skip the first 8 bytes (header)
                .toString('ascii')                    // Convert buffer to ASCII string
                .replace(`${keyword}=`, '')           // Remove the keyword prefix
                .replace(/\u0000/g, '');              // Remove null characters

            return osInfo;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting OS information:', err);
            // Re-throw the error for higher-level handling
            throw err;
        }
    }


    async getWorkCode() {
        const keyword = 'WorkCode';

        try {
            // Execute the command to get the WorkCode information
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the WorkCode information from the response data
            const workCode = data.slice(8)            // Skip the first 8 bytes (header)
                .toString('ascii')                  // Convert buffer to ASCII string
                .replace(`${keyword}=`, '')        // Remove the keyword prefix
                .replace(/\u0000/g, '');              // Remove null characters

            return workCode;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting WorkCode:', err);
            // Re-throw the error to be handled by the caller
            throw err;
        }
    }


    async getPIN() {
        const keyword = '~PIN2Width';

        try {
            // Execute the command to get the PIN information
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and format the PIN information from the response data
            const pin = data.slice(8)            // Skip the first 8 bytes (header)
                .toString('ascii')              // Convert buffer to ASCII string
                .replace(`${keyword}=`, '')    // Remove the keyword prefix
                .replace(/\u0000/g, '');              // Remove null characters

            return pin;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting PIN:', err);
            // Re-throw the error to be handled by the caller
            throw err;
        }
    }


    async getFaceOn() {
        const keyword = 'FaceFunOn';

        try {
            // Execute the command to get the face function status
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and process the status from the response data
            const status = data.slice(8)                        // Skip the first 8 bytes (header)
                .toString('ascii')                            // Convert buffer to ASCII string
                .replace(`${keyword}=`, '');                  // Remove the keyword prefix

            // Determine and return the face function status
            return status.includes('0') ? 'No' : 'Yes';
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting face function status:', err);
            // Re-throw the error to be handled by the caller
            throw err;
        }
    }


    async getSSR() {
        const keyword = '~SSR';

        try {
            // Execute the command to get the SSR value
            const data = await this.executeCmd(COMMANDS.CMD_OPTIONS_RRQ, keyword);

            // Extract and process the SSR value from the response data
            const ssrValue = data.slice(8)                // Skip the first 8 bytes (header)
                .toString('ascii')                       // Convert buffer to ASCII string
                .replace(`${keyword}=`, '');             // Remove the keyword prefix

            // Return the SSR value
            return ssrValue;
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting SSR value:', err);
            // Re-throw the error to be handled by the caller
            throw err;
        }
    }


    async getFirmware() {
        try {
            // Execute the command to get firmware information
            const data = await this.executeCmd(1100, '');

            // Extract and return the firmware version from the response data
            return data.slice(8).toString('ascii'); // Skip the first 8 bytes (header) and convert to ASCII string
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting firmware version:', err);
            // Re-throw the error to be handled by the caller
            throw err;
        }
    }


    async getTime() {
        try {
            // Execute the command to get the current time
            const response = await this.executeCmd(COMMANDS.CMD_GET_TIME, '');

            // Check if the response is valid
            if (!response || response.length < 12) {
                throw new Error('Invalid response received for time command');
            }

            // Extract and decode the time value from the response
            const timeValue = response.readUInt32LE(8); // Read 4 bytes starting at offset 8
            return timeParser.decode(timeValue); // Parse and return the decoded time
        } catch (err) {
            // Log the error for debugging
            console.error('Error getting time:', err);

            // Re-throw the error for the caller to handle
            throw err;
        }
    }


    async setTime(tm) {
        try {
            // Validate the input time
            if (!(tm instanceof Date) && typeof tm !== 'number') {
                throw new TypeError('Invalid time parameter. Must be a Date object or a timestamp.');
            }

            // Convert the input time to a Date object if it's not already
            const date = (tm instanceof Date) ? tm : new Date(tm);

            // Encode the time into the required format
            const encodedTime = timeParser.encode(date);

            // Create a buffer and write the encoded time
            const commandString = Buffer.alloc(32);
            commandString.writeUInt32LE(encodedTime, 0);

            // Send the command to set the time
            return await this.executeCmd(COMMANDS.CMD_SET_TIME, commandString);
        } catch (err) {
            // Log the error for debugging
            console.error('Error setting time:', err);
            // Re-throw the error for the caller to handle
            throw err;
        }
    }


    async voiceTest() {
        try {
            // Define the command data for the voice test
            const commandData = Buffer.from('\x00\x00', 'binary');

            // Execute the command and return the result
            return await this.executeCmd(COMMANDS.CMD_TESTVOICE, commandData);
        } catch (err) {
            // Log the error for debugging purposes
            console.error('Error executing voice test:', err);

            // Re-throw the error to be handled by the caller
            throw err;
        }
    }


    async setUser(uid, userid, name, password, role = 0, cardno = 0) {
        try {
            // Validate input parameters
            if (
                parseInt(uid) <= 0 || parseInt(uid) > 3000 ||
                userid.length > 9 ||
                name.length > 24 ||
                password.length > 8 ||
                cardno.toString().length > 10
            ) {
                throw new Error('Invalid input parameters');
            }

            // Allocate and initialize the buffer
            const commandBuffer = Buffer.alloc(72);

            // Fill the buffer with user data
            commandBuffer.writeUInt16LE(parseInt(uid), 0);
            commandBuffer.writeUInt16LE(role, 2);
            commandBuffer.write(password.padEnd(8, '\0'), 3, 8); // Ensure password is 8 bytes
            commandBuffer.write(name.padEnd(24, '\0'), 11, 24); // Ensure name is 24 bytes
            commandBuffer.writeUInt16LE(parseInt(cardno), 35);
            commandBuffer.writeUInt32LE(0, 40); // Placeholder or reserved field
            commandBuffer.write(userid.padEnd(9, '\0'), 48, 9); // Ensure userid is 9 bytes

            // Send the command and return the result
            return await this.executeCmd(COMMANDS.CMD_USER_WRQ, commandBuffer);

        } catch (err) {
            // Log error details for debugging
            console.error('Error setting user:', err);

            // Re-throw error for upstream handling
            throw err;
        }
    }

    /**
     * Register a user's face on the device
     * @param {string} userId - The user ID to register the face for
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async registerFace(userId) {
        try {
            // Validate input parameter
            if (!userId || userId.length > 9) {
                throw new Error('Invalid user ID');
            }

            // Create a buffer for the user ID
            const commandBuffer = Buffer.alloc(24);

            // Write user ID to the buffer (first 9 bytes)
            commandBuffer.write(userId.padEnd(9, '\0'), 0, 9);

            // Set flag for face registration (byte at position 9)
            commandBuffer.writeUInt8(50, 9); // Flag for face registration

            // Additional parameters for face quality and timeout
            commandBuffer.writeUInt16LE(70, 10); // Face quality threshold
            commandBuffer.writeUInt16LE(15000, 12); // Timeout in milliseconds

            // Send the command to start face enrollment with enhanced parameters
            const reply = await this.executeCmd(COMMANDS.CMD_STARTENROLL, commandBuffer);

            // Check if the reply indicates success
            if (reply && reply.length >= 8) {
                console.log('Face registration initiated, waiting for device to process...');

                // Wait longer for the device to complete the face capture process
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Send a follow-up command to confirm registration
                const confirmBuffer = Buffer.alloc(9);
                confirmBuffer.write(userId.padEnd(9, '\0'), 0, 9);
                await this.executeCmd(COMMANDS.CMD_REFRESHDATA, confirmBuffer);

                console.log('Face registration process completed');
                return true;
            } else {
                throw new Error('Failed to start face enrollment - device did not acknowledge');
            }
        } catch (err) {
            // Log error details for debugging
            console.error('Error registering face:', err);

            // Re-throw error for upstream handling
            throw err;
        }
    }

    async deleteUser(uid) {
        try {
            // Validate input parameter
            if (parseInt(uid) <= 0 || parseInt(uid) > 3000) {
                throw new Error('Invalid UID: must be between 1 and 3000');
            }

            // Allocate and initialize the buffer
            const commandBuffer = Buffer.alloc(72);

            // Write UID to the buffer
            commandBuffer.writeUInt16LE(parseInt(uid), 0);

            // Send the delete command and return the result
            return await this.executeCmd(COMMANDS.CMD_DELETE_USER, commandBuffer);

        } catch (err) {
            // Log error details for debugging
            console.error('Error deleting user:', err);

            // Re-throw error for upstream handling
            throw err;
        }
    }


    async getAttendanceSize() {
        try {
            // Execute command to get free sizes
            const data = await this.executeCmd(COMMANDS.CMD_GET_FREE_SIZES, '');

            // Parse and return the attendance size
            return data.readUIntLE(40, 4); // Assuming data at offset 40 represents the attendance size

        } catch (err) {
            // Log error details for debugging
            console.error('Error getting attendance size:', err);

            // Re-throw the error to be handled by the caller
            throw err;
        }
    }


// Clears the attendance logs on the device
    async clearAttendanceLog() {
        try {
            // Execute the command to clear attendance logs
            return await this.executeCmd(COMMANDS.CMD_CLEAR_ATTLOG, '');
        } catch (err) {
            // Log the error for debugging purposes
            console.error('Error clearing attendance log:', err);
            // Re-throw the error to be handled by the caller
            throw err;
        }
    }

// Clears all data on the device
    async clearData() {
        try {
            // Execute the command to clear all data
            return await this.executeCmd(COMMANDS.CMD_CLEAR_DATA, '');
        } catch (err) {
            // Log the error for debugging purposes
            console.error('Error clearing data:', err);
            // Re-throw the error to be handled by the caller
            throw err;
        }
    }

    async getRealTimeLogs(cb = () => {}) {
        this.replyId++; // Increment the reply ID for this request

        try {
            // Create a buffer with the command header to request real-time logs
            const buf = createTCPHeader(COMMANDS.CMD_REG_EVENT, this.sessionId, this.replyId, Buffer.from([0x01, 0x00, 0x00, 0x00]));

            // Send the request to the device
            this.socket.write(buf, null, (err) => {
                if (err) {
                    // Log and reject the promise if there is an error writing to the socket
                    console.error('Error sending real-time logs request:', err);
                    throw err;
                }
            });

            // Ensure data listeners are added only once
            if (this.socket.listenerCount('data') === 0) {
                this.socket.on('data', (data) => {
                    // Check if the data is an event and not just a regular response
                    if (checkNotEventTCP(data)) {
                        // Process the data if it is of the expected length
                        if (data.length > 16) {
                            // Decode and pass the log to the callback
                            cb(decodeRecordRealTimeLog52(data));
                        }
                    }
                });
            }

        } catch (err) {
            // Handle errors and reject the promise
            console.error('Error getting real-time logs:', err);
            throw err;
        }
    }

    async getSocketStatus() {
        try {
            // Execute the command to get the socket status
            const data = await this.executeCmd(COMMANDS.CMD_GET_SOCKET_STATUS, '');

            // Parse and return the socket status in a more readable format
            return {
                connected: this.socket && this.socket.readyState === 'open',
                sessionId: this.sessionId || null,
                lastActivity: this.authTimestamp ? new Date(this.authTimestamp).toISOString() : null,
                deviceIP: this.ip,
                devicePort: this.port,
                responseData: data
            };
        } catch (err) {
            console.error('Error getting socket status:', err);
            throw err;
        }
    }

    async restart() {
        try {
            if (!this.socket || this.socket.readyState !== 'open') {
                throw new Error('Socket connection is not open');
            }

            // Execute the restart command
            const response = await this.executeCmd(COMMANDS.CMD_RESTART, '');

            return {
                success: response && response.length > 0,
                message: response ? 'Device restart initiated successfully' : 'Failed to restart device'
            };
        } catch (err) {
            console.error('Error restarting device:', err);
            throw err;
        }
    }



    async validateSession() {
        try {
            // Check if session exists and is not expired
            if (!this.sessionId || !this.authTimestamp) {
                return false;
            }

            // Check if session is expired (30 minutes)
            const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
            if (Date.now() - this.authTimestamp > SESSION_TIMEOUT) {
                return false;
            }

            // Verify session is still valid with the device
            const reply = await this.executeCmd(COMMANDS.CMD_ACK_OK, '');
            return reply && reply.length >= 6 && reply.readUInt16LE(4) === this.sessionId;
        } catch (err) {
            console.error('Session validation failed:', err);
            return false;
        }
    }

    /**
     * Delete a fingerprint template for a specific user and finger index
     * @param {string} userId - User ID
     * @param {number} fingerIndex - Finger index (0-9)
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async deleteFingerprintTemplate(userId, fingerIndex) {
        try {
            // Validate input parameters
            if (!userId || userId.length > 9 || fingerIndex < 0 || fingerIndex > 9) {
                throw new Error('Invalid user ID or finger index');
            }

            // Create buffer for delete info
            const delInfo = Buffer.alloc(72);
            delInfo.write(userId.padEnd(9, '\0'), 0, 9);
            delInfo.writeUInt8(fingerIndex, 24);

            // Send delete command
            const reply = await this.executeCmd(COMMANDS.CMD_DEL_FPTMP, delInfo);

            // Refresh data after deletion
            await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '');

            return reply && reply.length >= 6;
        } catch (err) {
            console.error('Error deleting fingerprint template:', err);
            throw err;
        }
    }

    /**
     * Delete all fingerprint templates for a user
     * @param {number} userSn - User serial number
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async deleteAllFingerprintTemplates(userSn) {
        try {
            // Validate input parameter
            if (userSn <= 0 || userSn > 3000) {
                throw new Error('Invalid user serial number');
            }

            // Create buffer for delete info
            const delInfo = Buffer.alloc(3);
            delInfo.writeUInt16LE(userSn, 0);
            delInfo.writeUInt8(0, 2);

            // Send delete command
            const reply = await this.executeCmd(COMMANDS.CMD_DELETE_USERTEMP, delInfo);

            // Refresh data after deletion
            await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '');

            return reply && reply.length >= 6;
        } catch (err) {
            console.error('Error deleting all fingerprint templates:', err);
            throw err;
        }
    }

    /**
     * Get a fingerprint template for a specific user and finger index
     * @param {number} userSn - User serial number
     * @param {number} fingerIndex - Finger index (0-9)
     * @returns {Promise<Buffer>} - Returns the fingerprint template data
     */
    async getFingerprintTemplate(userSn, fingerIndex) {
        try {
            // Validate input parameters
            if (userSn <= 0 || userSn > 3000 || fingerIndex < 0 || fingerIndex > 9) {
                throw new Error('Invalid user serial number or finger index');
            }

            // Free any existing buffer data
            await this.freeData();

            // Create buffer for template request
            const reqData = Buffer.alloc(4);
            reqData.writeUInt16LE(userSn, 0);
            reqData.writeUInt8(fingerIndex, 2);
            reqData.writeUInt8(0, 3); // Flag

            // First, check if the template exists
            const checkReply = await this.executeCmd(COMMANDS.CMD_USERTEMP_RRQ, reqData);

            if (!checkReply || checkReply.length < 8) {
                throw new Error('Template not found or invalid response');
            }

            // Get the size of the template from the reply
            const size = checkReply.readUInt16LE(6);

            if (size === 0) {
                throw new Error('Template size is zero');
            }

            // Prepare to receive the template data
            const templateData = await this.executeCmd(COMMANDS.CMD_PREPARE_DATA, reqData);

            if (!templateData || templateData.length < size) {
                throw new Error('Failed to retrieve complete template data');
            }

            // Free buffer after operation
            await this.freeData();

            return templateData;
        } catch (err) {
            console.error('Error getting fingerprint template:', err);
            throw err;
        }
    }

    /**
     * Upload a fingerprint template for a user
     * @param {number} userSn - User serial number
     * @param {number} fingerIndex - Finger index (0-9)
     * @param {Buffer} templateData - Fingerprint template data
     * @param {number} flag - Template flag (0=invalid, 1=valid, 3=duress)
     * @returns {Promise<boolean>} - Returns true if successful
     */
    async uploadFingerprintTemplate(userSn, fingerIndex, templateData, flag = 1) {
        try {
            // Validate input parameters
            if (userSn <= 0 || userSn > 3000 || fingerIndex < 0 || fingerIndex > 9 || !Buffer.isBuffer(templateData)) {
                throw new Error('Invalid parameters');
            }

            // Disable device before upload
            await this.disableDevice();

            try {
                // Prepare data buffer
                const prepData = Buffer.alloc(6);
                prepData.writeUInt16LE(templateData.length, 0);
                prepData.writeUInt32LE(0, 2);

                // Send prepare data command
                await this.executeCmd(COMMANDS.CMD_PREPARE_DATA, prepData);

                // Send template data
                await this.executeCmd(COMMANDS.CMD_DATA, templateData);

                // Get checksum
                const checksumReply = await this.executeCmd(COMMANDS.CMD_CHECKSUM_BUFFER, '');
                if (!checksumReply || checksumReply.length < 6) {
                    throw new Error('Failed to get checksum');
                }

                // Create template write request
                const tmpWriteReq = Buffer.alloc(6);
                tmpWriteReq.writeUInt16LE(userSn, 0);
                tmpWriteReq.writeUInt8(fingerIndex, 2);
                tmpWriteReq.writeUInt8(flag, 3);
                tmpWriteReq.writeUInt16LE(templateData.length, 4);

                // Write template
                const writeReply = await this.executeCmd(COMMANDS.CMD_TMP_WRITE, tmpWriteReq);
                if (!writeReply || writeReply.length < 6) {
                    throw new Error('Failed to write template');
                }

                // Free data buffer
                await this.freeData();

                // Refresh data
                await this.executeCmd(COMMANDS.CMD_REFRESHDATA, '');

                return true;
            } finally {
                // Always enable device after upload attempt
                await this.enableDevice();
            }
        } catch (err) {
            console.error('Error uploading fingerprint template:', err);
            throw err;
        }
    }

    /**
     * Read all fingerprint templates from the device
     * @returns {Promise<Array>} - Returns array of template entries
     */
    async readAllTemplates() {
        try {
            // Disable device before reading
            await this.disableDevice();

            try {
                // Send command to read all templates
                const reply = await this.executeCmd(COMMANDS.CMD_DATA_WRRQ, Buffer.from([0x01, 0x07, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));

                if (!reply || reply.length < 8) {
                    throw new Error('Failed to read templates');
                }

                const templates = [];
                let offset = 4; // Skip header

                // Read total size of templates
                const totalSize = reply.readUInt32LE(offset);
                offset += 4;

                // Read each template entry
                while (offset < reply.length) {
                    if (reply.length - offset < 6) break; // Need at least 6 bytes for entry header

                    const entrySize = reply.readUInt16LE(offset);
                    if (entrySize < 6) break; // Invalid entry size

                    const userSn = reply.readUInt16LE(offset + 2);
                    const fingerIndex = reply.readUInt8(offset + 4);
                    const flag = reply.readUInt8(offset + 5);

                    // Extract template data
                    const templateData = reply.slice(offset + 6, offset + entrySize);

                    templates.push({
                        userSn,
                        fingerIndex,
                        flag,
                        templateData
                    });

                    offset += entrySize;
                }

                return templates;
            } finally {
                // Always enable device after reading
                await this.enableDevice();
            }
        } catch (err) {
            console.error('Error reading all templates:', err);
            throw err;
        }
    }

    /**
     * Capture an image from the device
     * @returns {Promise<Buffer>} - Returns the captured image data
     */
    async captureImage() {
        try {
            // Disable device before capture
            await this.disableDevice();

            try {
                // Free any existing buffer data
                await this.freeData();

                // Send capture command
                const captureReply = await this.executeCmd(COMMANDS.CMD_CAPTUREIMAGE, '');
                if (!captureReply || captureReply.length < 8) {
                    throw new Error('Failed to initiate image capture');
                }

                // Get the size of the image data
                const size = captureReply.readUInt32LE(4);
                if (size === 0) {
                    throw new Error('Captured image size is zero');
                }

                // Prepare to receive the image data
                const prepData = Buffer.alloc(8);
                prepData.writeUInt32LE(size, 0); // Use 32-bit for size
                prepData.writeUInt32LE(0, 4); // Reserved bytes

                // Send prepare data command
                await this.executeCmd(COMMANDS.CMD_PREPARE_DATA, prepData);

                // Receive the image data in chunks
                const MAX_CHUNK_SIZE = 1024;
                let imageData = Buffer.alloc(0);
                let remainingSize = size;

                while (remainingSize > 0) {
                    const chunkSize = Math.min(MAX_CHUNK_SIZE, remainingSize);
                    const chunk = await this.executeCmd(COMMANDS.CMD_DATA, '');
                    if (chunk && chunk.length > 0) {
                        imageData = Buffer.concat([imageData, chunk]);
                        remainingSize -= chunk.length;
                    } else {
                        throw new Error('Failed to receive image chunk');
                    }
                }

                // Free buffer after operation
                await this.freeData();

                return imageData;
            } finally {
                // Always enable device after capture attempt
                await this.enableDevice();
            }
        } catch (err) {
            console.error('Error capturing image:', err);
            throw err;
        }
    }

}


module.exports = ZTCP
