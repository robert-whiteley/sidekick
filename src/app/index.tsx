import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sidekick</Text>
      <Text>Your on-device assistant.</Text>
      <Link href="/bench" style={styles.link}>
        Engine benchmark
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 28, fontWeight: '600' },
  link: { marginTop: 24, color: '#2563eb', fontSize: 16 },
});
