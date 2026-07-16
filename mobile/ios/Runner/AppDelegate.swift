import Flutter
import UIKit
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var pushChannel: FlutterMethodChannel?
  private var deviceToken: String?
  private var pendingRegistrationResult: FlutterResult?
  private var pendingBriefDate: String?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "WatchTowerPush") else { return }
    let channel = FlutterMethodChannel(name: "io.damao.watchtower/push", binaryMessenger: registrar.messenger())
    pushChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handlePushCall(call, result: result)
    }
    if let date = pendingBriefDate {
      channel.invokeMethod("notificationOpened", arguments: ["briefDate": date])
      pendingBriefDate = nil
    }
  }

  private func handlePushCall(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "isSupported":
      result(true)
    case "authorizationStatus":
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        DispatchQueue.main.async { result(self.statusName(settings.authorizationStatus)) }
      }
    case "requestAuthorization":
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
        DispatchQueue.main.async {
          guard error == nil, granted else {
            result(["status": "denied"])
            return
          }
          self.pendingRegistrationResult = result
          UIApplication.shared.registerForRemoteNotifications()
        }
      }
    case "currentToken":
      if let token = deviceToken {
        result(tokenPayload(token))
      } else {
        pendingRegistrationResult = result
        UIApplication.shared.registerForRemoteNotifications()
      }
    case "unregister":
      UIApplication.shared.unregisterForRemoteNotifications()
      deviceToken = nil
      result(nil)
    case "openSettings":
      guard let url = URL(string: UIApplication.openSettingsURLString) else {
        result(FlutterError(code: "SETTINGS_UNAVAILABLE", message: nil, details: nil))
        return
      }
      UIApplication.shared.open(url) { _ in result(nil) }
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken tokenData: Data
  ) {
    let token = tokenData.map { String(format: "%02x", $0) }.joined()
    deviceToken = token
    pendingRegistrationResult?(tokenPayload(token))
    pendingRegistrationResult = nil
  }

  override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    pendingRegistrationResult?(FlutterError(code: "APNS_REGISTRATION_FAILED", message: "Unable to register with APNs.", details: nil))
    pendingRegistrationResult = nil
  }

  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if let date = response.notification.request.content.userInfo["briefDate"] as? String {
      if let pushChannel {
        pushChannel.invokeMethod("notificationOpened", arguments: ["briefDate": date])
      } else {
        pendingBriefDate = date
      }
    }
    completionHandler()
  }

  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound])
  }

  private func tokenPayload(_ token: String) -> [String: String] {
    #if DEBUG
    return ["status": "authorized", "token": token, "environment": "sandbox"]
    #else
    return ["status": "authorized", "token": token, "environment": "production"]
    #endif
  }

  private func statusName(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .provisional, .ephemeral: return "provisional"
    case .denied: return "denied"
    default: return "unknown"
    }
  }
}
