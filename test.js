const Zkteco = require("./index.js");

const manageZktecoDevice = async () => {
    const device = new Zkteco("192.168.18.201", 4370, 5200, 5000);

    try {
        // Create socket connection to the device
        await device.createSocket();

        // Retrieve and log all attendance records
        // Check if face recognition is enabled on the device
        const faceEnabled = await device.getFaceOn();
        console.log(`Face recognition is ${faceEnabled ? 'enabled' : 'disabled'} on this device`);

        if (faceEnabled) {
            await device.setUser(1, "1", "John Doe");

            // Register face for user with ID 1
            console.log('Please position your face in front of the device...');
            const faceRegistrationResult = await device.registerFace("1");

            if (faceRegistrationResult) {
                // Capture the face image
                await device.captureImage();
                console.log('Face registration initiated successfully!');
                console.log('The device will now capture your face data.');
            } else {
                console.log('Failed to initiate face registration.');
            }
        } else {
            console.log('Face recognition is not enabled on this device.');
        }

        // For photo upload, you would typically need to:
        // 1. Convert the photo to the device's required format
        // 2. Use a specific API call to upload the photo template
        // Note: This depends on the specific device capabilities and API
        console.log(attendanceLogs);

        // const registerFace = await device.registerFace("3");
        // console.log(registerFace);

        // const info = await device.getSSR();
        // console.log(info);

        // // Listen for real-time logs
        // await device.getRealTimeLogs((realTimeLog) => {
        //     console.log(realTimeLog);
        // });

        // Manually disconnect after using real-time logs
        await device.disconnect();
    } catch (error) {
        console.error("Error:", error);
    }
};

manageZktecoDevice();
