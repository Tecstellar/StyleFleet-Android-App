import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { LanguageProvider } from './src/i18n/LanguageContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { loadAppFonts } from './src/theme/initFonts';

import { OtaUpdateCard } from './src/components/common/OtaUpdateCard';
import { View } from 'react-native';

function ThemedApp() {
  const { isDark } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
      <OtaUpdateCard />
    </View>
  );
}

export default function App() {
  useEffect(() => {
    loadAppFonts();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <LanguageProvider>
          <ThemedApp />
        </LanguageProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
