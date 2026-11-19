// Only a site that has not asked yet is told "denied"; one the owner already allowed or blocked in Chrome gets Chrome's own answer.
// The permission is read through the getter saved at document_start, so a page that redefines `Notification.permission` can't reach the prompt.
const apply = Reflect.apply;
const N = typeof Notification === 'undefined' ? undefined : Notification;
const getPermission = N && Object.getOwnPropertyDescriptor(N, 'permission')?.get;
const permission = (): NotificationPermission => (getPermission ? apply(getPermission, N, []) : 'default');

if (N) {
  const requestPermission = N.requestPermission;
  N.requestPermission = function (this: unknown, callback?: NotificationPermissionCallback) {
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
