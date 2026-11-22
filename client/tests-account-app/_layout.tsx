import { Stack } from 'expo-router';
import { Provider } from '@/components/Provider';
import '../global.css';

// Separate opt-in /ceshi/ rehearsal: ordinary chat and the mock quiz do not mount.
export default function TestsLayout() {
  return <Provider><Stack screenOptions={{ headerShown: false }} /></Provider>;
}
