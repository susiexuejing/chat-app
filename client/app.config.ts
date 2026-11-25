import type { ExpoConfig, ConfigContext } from 'expo/config';

const appName = process.env.COZE_PROJECT_NAME || process.env.EXPO_PUBLIC_COZE_PROJECT_NAME || '应用';
const projectId = process.env.COZE_PROJECT_ID || process.env.EXPO_PUBLIC_COZE_PROJECT_ID;
const slugAppName = projectId ? `app${projectId}` : 'myapp';

export default ({ config }: ConfigContext): ExpoConfig => {
  const testsBasePath = process.env.EXPO_PUBLIC_TESTS_DEMO_BASE_PATH || '';
  const testsDemo = process.env.EXPO_PUBLIC_TESTS_DEMO === '1';
  const accountOffline = process.env.EXPO_PUBLIC_TESTS_ACCOUNT_OFFLINE === '1';
  const protectedDev = process.env.EXPO_PUBLIC_TESTS_ACCOUNT_PROTECTED_DEV === '1';
  const publicReal = process.env.EXPO_PUBLIC_TESTS_ACCOUNT_PUBLIC_REAL === '1';
  if (publicReal && (accountOffline || protectedDev)) {
    throw new Error('Public quiz account mode cannot be combined with synthetic QA');
  }
  if (publicReal && (!testsDemo || testsBasePath !== '/ceshi')) {
    throw new Error('Public quiz account mode requires the opt-in /ceshi tests build');
  }
  if (protectedDev && !accountOffline) {
    throw new Error('Protected DEV quiz QA requires the opt-in account tests build');
  }
  if (accountOffline && (!testsDemo || testsBasePath !== '/ceshi')) {
    throw new Error('Offline quiz account build requires the opt-in /ceshi tests build');
  }
  if (testsDemo && !['', '/ceshi'].includes(testsBasePath)) {
    throw new Error('EXPO_PUBLIC_TESTS_DEMO_BASE_PATH must be empty or /ceshi');
  }
  return {
    ...config,
    "name": appName,
    "slug": slugAppName,
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "myapp",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": `com.anonymous.x${projectId || '0'}`
    },
    "web": {
      "bundler": "metro",
      "output": "single",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      [
        "expo-secure-store",
        {
          "configureAndroidBackup": true
        }
      ],
      testsDemo ? [
        'expo-router', { root: (accountOffline || publicReal) ? './tests-account-app' : './tests-app' }
      ] : process.env.EXPO_PUBLIC_BACKEND_BASE_URL ? [
        "expo-router",
        {
          "origin": process.env.EXPO_PUBLIC_BACKEND_BASE_URL
        }
      ] : 'expo-router',
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff"
        }
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": `允许角色对话App访问您的相册，以便您上传或保存图片。`,
          "cameraPermission": `允许角色对话App使用您的相机，以便您直接拍摄照片上传。`,
          "microphonePermission": `允许角色对话App访问您的麦克风，以便您拍摄带有声音的视频。`
        }
      ],
      [
        "expo-location",
        {
          "locationWhenInUsePermission": `角色对话App需要访问您的位置以提供周边服务及导航功能。`
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": `角色对话App需要访问相机以拍摄照片和视频。`,
          "microphonePermission": `角色对话App需要访问麦克风以录制视频声音。`,
          "recordAudioAndroid": true
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true,
      ...(testsDemo && testsBasePath ? { baseUrl: testsBasePath } : {})
    },
    "extra": {
      "backendBaseUrl": process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091',
      "cozeBotId": process.env.EXPO_PUBLIC_COZE_BOT_ID || '7635592039983644682'
    }
  }
}
