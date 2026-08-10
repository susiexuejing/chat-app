// Minimal react-native mock for testing
const React = require('react');

const createMockComponent = (name) => {
  const Component = React.forwardRef((props, ref) => {
    return React.createElement(name, { ...props, ref });
  });
  Component.displayName = name;
  return Component;
};

const ScrollView = React.forwardRef((props, ref) => {
  // Attach scrollToEnd to the ref if it's an object
  React.useImperativeHandle(ref, () => ({
    scrollToEnd: jest.fn(),
  }));
  return React.createElement('ScrollView', props);
});
ScrollView.displayName = 'ScrollView';

module.exports = {
  Platform: { OS: 'web' },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: 'active',
  },
  Keyboard: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  View: createMockComponent('View'),
  Text: createMockComponent('Text'),
  TouchableOpacity: createMockComponent('TouchableOpacity'),
  ScrollView,
  TextInput: createMockComponent('TextInput'),
  Image: createMockComponent('Image'),
  ActivityIndicator: createMockComponent('ActivityIndicator'),
  StyleSheet: {
    create: (styles) => styles,
    flatten: (styles) => {
      if (!styles) return {};
      if (Array.isArray(styles)) {
        return Object.assign({}, ...styles.map((s) => (typeof s === 'object' ? s : {})));
      }
      return typeof styles === 'object' ? styles : {};
    },
  },
  Alert: {
    alert: jest.fn(),
  },
};
