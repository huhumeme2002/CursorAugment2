module.exports = {
    apps: [{
        name: "cursor-augment-proxy",
        script: "./dist/server.js",
        instances: "max", // Use all CPU cores
        exec_mode: "cluster",
        env: {
            NODE_ENV: "production",
            PORT: 3000
        },
        watch: false,
        max_memory_restart: "1G",

        // Graceful shutdown: wait 30s for active requests to finish before force-killing
        kill_timeout: 30000,

        // Wait for app to send 'ready' signal before routing traffic
        wait_ready: true,
        listen_timeout: 10000,

        // Prevent infinite crash loops
        max_restarts: 15,
        restart_delay: 2000
    }]
};
