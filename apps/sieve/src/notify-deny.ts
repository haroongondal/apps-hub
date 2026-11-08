// Only a site that has not asked yet is told "denied"; one the owner already allowed or blocked in Chrome gets Chrome's own answer.
const apply = Reflect.apply;
const permission = () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission);

if (typeof Notification !== 'undefined') {
  const requestPermission = Notification.requestPermission;
  Notification.requestPermission = function (this: unknown, callback?: NotificationPermissionCallback) {
    if (permission() !== 'default') return apply(requestPermission, this, arguments);
    const answer = Promise.resolve<NotificationPermission>('denied');
    if (typeof callback === 'function') answer.then(callback);
    return answer;
  };
}
if (typeof PushManager !== 'undefined') {
  const subscribe = PushManager.prototype.subscribe;
  PushManager.prototype.subscribe = function (this: PushManager) {
    return permission() === 'granted' ? apply(subscribe, this, arguments) : Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  };
}

export {};
