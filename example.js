/**
 * Example: Setting a user and registering their face
 *
 * This example demonstrates how to:
 * 1. Connect to a ZKTeco device
 * 2. Set a new user with basic information
 * 3. Register the user's face
 * 4. Verify the user was added successfully
 */

const Zkteco = require('./index');

const manageZktecoDevice = async () => {
    // Create a new instance of Zkteco
    // Parameters: IP address, port, timeout, inport
    const device = new Zkteco("192.168.18.201", 4370, 5200, 5000);

    try {
        // Create socket connection to the device
        console.log('Connecting to device...');
        await device.createSocket();
        console.log('Connected successfully!');

        // Check if face recognition is enabled on the device
        const faceEnabled = await device.getFaceOn();
        console.log(`Face recognition is ${faceEnabled} on this device`);

        if (faceEnabled === 'No') {
            console.log('Face recognition is not enabled on this device. Cannot proceed with face registration.');
            return;
        }

        // Define user information
        const userId = "100"; // User ID (must be unique)
        const userName = "John Doe"; // User name
        const userPassword = ""; // User password (optional)
        const userRole = 0; // User role (0 = normal user)
        const userCardNo = 0; // Card number (optional)

        // Set the user on the device
        console.log(`Setting user ${userName} (ID: ${userId})...`);
        await device.setUser(userId, userId, userName, userPassword, userRole, userCardNo, faceTemplate);
        console.log('User set successfully!');

        // Register the user's face
        console.log(`Registering face for user ${userName} (ID: ${userId})...`);
        console.log('Please position your face in front of the device...');

        // // const faceRegistrationResult = await device.registerFace(userId);

        // if (faceRegistrationResult) {
        //     await device.captureImage();
        //     console.log('Face registration initiated successfully!');
        //     console.log('The device will now capture your face data.');
        //     console.log('Please follow the on-device instructions to complete the registration.');
        // } else {
        //     console.log('Failed to initiate face registration.');
        // }

        // Verify the user was added by retrieving the user list
        console.log('Verifying user was added...');
        const users = await device.getUsers();

        const addedUser = users.data.find(user => user.userId === userId);
        if (addedUser) {
            console.log('User verification successful!');
            console.log('User details:', addedUser);
        } else {
            console.log('User verification failed. User was not found in the device.');
        }

        // Disconnect from the device
        console.log('Disconnecting from device...');
        await device.disconnect();
        console.log('Disconnected successfully!');

    } catch (error) {
        console.error("Error:", error);
    }
};

// Run the example
manageZktecoDevice();
