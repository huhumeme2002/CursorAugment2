module.exports = {
    apps: [{
        name: "cursor-augment-proxy",
        script: "./server.ts",
        interpreter: "node",
        interpreter_args: "-r ts-node/register",
        instances: "max", // Use all CPU cores (since you have 4 cores!)
        exec_mode: "cluster",
        env: {
            NODE_ENV: "production",
            PORT: 3000
        },
        watch: false,
        max_memory_restart: "1G"
    }]
};
