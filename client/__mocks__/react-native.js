// Minimal react-native mock for testing
module.exports = {
  Platform: { OS: 'web' },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: 'active',
  },
  Keyboard: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  StyleSheet: {
    create: (styles) => styles,
  },
  Alert: {
    alert: jest.fn(),
  },
};
