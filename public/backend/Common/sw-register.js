// Service Worker Registration
// Registers the service worker to enable offline functionality

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('✅ Service Worker registered successfully:', registration.scope);

                // Check for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    console.log('🔄 Service Worker update found');

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('✨ New Service Worker available - refresh to update');

                            // Optionally show a notification to the user
                            if (window.showPopupMessage) {
                                window.showPopupMessage(
                                    'New version available! Please refresh the page.',
                                    'info',
                                    { autoClose: false }
                                );
                            }
                        }
                    });
                });
            })
            .catch((error) => {
                console.error('❌ Service Worker registration failed:', error);
            });
    });

    // Handle service worker updates
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            console.log('🔄 Service Worker controller changed - reloading page');
            window.location.reload();
        }
    });
}

export function registerServiceWorker() {
    // This function is called automatically when this module is imported
    console.log('Service Worker registration module loaded');
}
