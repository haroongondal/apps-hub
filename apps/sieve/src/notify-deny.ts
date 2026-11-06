if (typeof Notification !== 'undefined') {
  Notification.requestPermission = (callback?: NotificationPermissionCallback) => {
    const answer = Promise.resolve<NotificationPermission>('denied');
    if (typeof callback === 'function') answer.then(callback);
    return answer;
  };
}
if (typeof PushManager !== 'undefined') {
  PushManager.prototype.subscribe = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
}

export {};
