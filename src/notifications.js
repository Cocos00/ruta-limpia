import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

export async function requestNotificationPermission() {
  if (Capacitor.isNativePlatform()) {
    const result = await LocalNotifications.requestPermissions()
    return result.display === 'granted'
  }
  if (!('Notification' in window)) return false
  return (await Notification.requestPermission()) === 'granted'
}

export async function sendDeviceNotification(title, body) {
  if (Capacitor.isNativePlatform()) {
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.floor(Date.now() % 2147483647),
        title,
        body,
        schedule: { at: new Date(Date.now() + 250) },
      }],
    })
    return
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.svg' })
  }
}
