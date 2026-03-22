# Foundry Launcher

This is a small application to run along a self-hosted FoundryVTT instance so that non-admin users can launch worlds whenever they need. It automatically shuts them down when there are no more active users for a period of time.

### Install

```bash
git clone https://github.com/erizocosmico/foundry-launcher.git
cd foundry-launcher
npm install
cp config.example.json config.json
# edit your config.json
npm start
```

You can then install this as a long-running service using your tool of choice. For example, you could add this as a systemd unit.

```
[Unit]
Description=Foundry Launcher
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/foundry-launcher
ExecStart=/path/to/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Write this to `/etc/systemd/system/foundry-launcher.service`, and then run:

```
sudo systemctl daemon-reload
sudo systemctl enable foundryvtt
sudo systemctl start foundryvtt
sudo systemctl status foundryvtt
```

### Proxy

Ideally, you should put a proxy on top of both foundry and this application so that nobody outside your home network can see any admin-related path and is, instead, redirected to this.

You can use something like Caddy or nginx for this.

```
:30001 {
        @blocked {
                path /setup* /admin* /auth
                not remote_ip 192.168.1.0/24
        }
        redir @blocked /launch

        handle_path /launch* {
                reverse_proxy localhost:3001
        }

        reverse_proxy localhost:30000
}
```

Change 30001 with the port you will be serving these two applications in, 3001 with the port where foundry launcher is running and 30000 with the port where Foundry is running.