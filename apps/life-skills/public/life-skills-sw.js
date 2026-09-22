/* Network-only PWA shell: NO fetch interception, offline clinical cache, transcript data or authentication material. */
self.addEventListener('install',()=>{ /* Activate on the browser's normal lifecycle; don't force a reload during an edit. */ });
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('ls-public-shell-')).map(key=>caches.delete(key)))));
});
self.addEventListener('push',event=>{
  let data={};try{data=event.data?event.data.json():{};}catch{data={};}
  const he=data.locale==='he';
  // Never display remote message text, child names, task titles, diagnoses or free-form payload content.
  const path=typeof data.path==='string'&&/^\/(en|he)\/(app|family|client)(?:\/[a-zA-Z0-9_-]+)*$/.test(data.path)?data.path:(he?'/he/family':'/en/family');
  event.waitUntil(self.registration.showNotification(he?'כישורי חיים':'Life Skills',{
    body:he?'יש עדכון באפליקציה. יש להיכנס כדי לצפות בו.':'There is an update in the app. Sign in to view it.',
    icon:'/pwa/icon-192.png',badge:'/pwa/icon-192.png',data:{path},
    // No attacker-controlled tag, image, action URL or content is accepted.
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const path=event.notification.data?.path;
  const safe=typeof path==='string'&&/^\/(en|he)\/(app|family|client)(?:\/[a-zA-Z0-9_-]+)*$/.test(path)?path:'/en/family';
  event.waitUntil(clients.openWindow(new URL(safe,self.location.origin).href));
});
