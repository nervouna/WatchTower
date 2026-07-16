class AppConfig {
  const AppConfig._();

  static const apiBaseUrl = String.fromEnvironment(
    'WATCHTOWER_API_BASE_URL',
    defaultValue: 'https://watchtower.damao.io',
  );
}
