<p align="center"><a href="https://www.zkteco.com/" target="_blank"><img src="https://raw.githubusercontent.com/coding-libs/zkteco-js/master/logo.jpg" width="400" alt="Zkteco Logo"></a></p>


## <span style="color:red;">Warning</span>

**⚠️ This repository is not recommended for use in production. ⚠️**

This repository is currently in development and may contain bugs or incomplete features. Use at your own risk and do not deploy to a production environment.

# About zkteco-js
The zkteco-js library provides a robust solution for Node.js developers to interface with ZK BioMetric Fingerprint Attendance Devices. Its user-friendly API allows seamless extraction of data, such as registered users, logs, and device versions. Developers can also add users, retrieve real-time logs, and clear attendance records. Using a socket connection, the library ensures fast and reliable data exchange. Whether creating an attendance system or a time-and-attendance management application, zkteco-js is the essential tool for integrating biometric devices efficiently.

### Installation

```bash
npm i zkteco-js
```

Or, if you prefer Yarn:

```bash
yarn add zkteco-js
```

### Usage Example

```js
const Zkteco = require("zkteco-js");

const manageZktecoDevice = async () => {
    const device = new Zkteco("192.168.1.106", 4370, 5200, 5000);

    try {
        // Create socket connection to the device
        await device.createSocket();

        // Retrieve and log all attendance records
        const attendanceLogs = await device.getAttendances();
        console.log(attendanceLogs);

        // Listen for real-time logs
        await device.getRealTimeLogs((realTimeLog) => {
            console.log(realTimeLog);
        });

        // Manually disconnect after using real-time logs
        await device.disconnect();
    } catch (error) {
        console.error("Error:", error);
    }
};

manageZktecoDevice();
```

### API Reference :

- `createSocket()` - Establishes a connection to the device.
- `getInfo()` - Provides general information about the device, including log capacity and user count.
- `getUsers()` - Retrieves an array of all users stored on the device.
- `setUser(uid, userid, name, password, role = 0, cardno = 0)` - Adds a new user to the device.
- <span style="color: green; font-weight: bold;">🆕 `deleteUser(uid)` - Delete an user from the device.</span>
- `getAttendances()` - Retrieves an array of all attendance logs from the device.
- `getRealTimeLogs(callback)` - Sets up a real-time log stream and calls the provided callback function with each new log entry.
- `getPIN()` - Retrieves the device PIN.
- `getTime()` - Retrieves the current time from the device.
- <span style="color: green; font-weight: bold;">🆕 `setTime(DateTime)` - Updates the device's time.</span>
- `getFaceOn()` - Checks if the device's Face On feature is enabled.
- `getSSR()` - Retrieves the device's Self-Service Recorder (SSR) status.
- `getDeviceVersion()` - Retrieves the device's firmware version.
- `getDeviceName()` - Retrieves the device's name.
- `getPlatform()` - Retrieves the device's platform version.
- `getOS()` - Retrieves the device's operating system version.
- `getAttendanceSize()` - Retrieves the total number of attendance records stored on the device.
- `clearAttendanceLog()` - Clears all attendance logs from the device.
- `disconnect()` - Disconnects the device from the network.
- <span style="color: green; font-weight: bold;">🆕 `clearData()` - Clear All Data from the device (all users,attendances logs etc ).</span>
- <span style="color: green; font-weight: bold;">🆕 `voiceTest()` - Voice Test.</span>
- <span style="color: green; font-weight: bold;">🆕 `getVendor()` - get vendor name.</span>
- <span style="color: green; font-weight: bold;">🆕 `getProductTime()` - get product created time.</span>
- <span style="color: green; font-weight: bold;">🆕 `getMacAddress()` - get device MAC address.</span>

## Contributing

Please see [CONTRIBUTING](https://github.com/coding-libs/zkteco-js/graphs/contributors) for details.
## Security

### Authentication
The library now implements secure authentication with the following features:
- Password hashing using SHA-256
- Protection against replay attacks using timestamps
- Session management with automatic expiration
- Environment variable based password configuration

To use the library securely:
1. Set your device password in the environment variable `ZKTECO_PASSWORD`
2. Never hardcode passwords in your application
3. Regularly rotate your device passwords
4. Use strong passwords that meet security requirements

Example of setting up secure authentication:
```bash
# Set the device password in environment variable
export ZKTECO_PASSWORD="your-secure-password"

# Or in your application
process.env.ZKTECO_PASSWORD = "your-secure-password";
```

### Security Best Practices
- Keep your device firmware updated to the latest version
- Use a secure network connection (VPN or dedicated network)
- Regularly monitor device logs for suspicious activity
- Implement proper access controls and user management
- Follow the principle of least privilege when assigning user roles

If you've found a security vulnerability, please report it to [codinglibs4u@gmail.com](mailto:codinglibs4u@gmail.com) instead of using the issue tracker.

## Alternatives

- [adrobinoga/zk-protocol](https://github.com/adrobinoga/zk-protocol)
- [dnaextrim/python_zklib](https://github.com/dnaextrim/python_zklib)
- [caobo171/node-zklib](https://github.com/caobo171/node-zklib)


## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
