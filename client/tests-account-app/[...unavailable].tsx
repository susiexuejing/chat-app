import { Redirect } from 'expo-router';
// Old bookmarks cannot open hidden modules inside the tests-only build.
export default function Unavailable() { return <Redirect href="/" />; }
