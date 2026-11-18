import { Stack } from 'expo-router';
import { Provider } from '@/components/Provider';
import '../global.css';

// Separate, opt-in route tree: legacy chat routes never mount in this build.
export default function TestsLayout() {
  return <Provider><Stack screenOptions={{ headerShown: false }} /></Provider>;
}
