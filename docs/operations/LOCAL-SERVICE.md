# 本机采集服务

[#18](https://github.com/zequnjiang/appeye/issues/18) 的定时器在 Appeye Node 服务内运行，每 60 分钟持久调度发现与详情，macOS launchd 负责登录后启动和进程退出后恢复。主机需处于运行状态；不依赖 Codex 对话继续推理。实际安装状态以部署报告为准。

使用 [launchd 模板](../../ops/launchd/com.appeye.collector.plist.example)，将 Node 和项目路径占位符替换为绝对路径。先执行 `npm run check` 构建，再将配置安装到 `~/Library/LaunchAgents/com.appeye.collector.plist`。密码和会话密钥保留在项目 `.env`，不填入模板、日志或 GitHub。

- 启动：`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.appeye.collector.plist`
- 状态：`launchctl print gui/$(id -u)/com.appeye.collector`
- 停止：`launchctl bootout gui/$(id -u)/com.appeye.collector`
- 重启：`launchctl kickstart -k gui/$(id -u)/com.appeye.collector`

日常更新应先停止服务、完成构建和验证，再 bootstrap 启动。停止时给正在处理的请求留出正常退出时间；故障退出后任务按持久检查点恢复。服务会自动寻找已经 seeded 且有待处理任务的旧扫描批次，不重新 seed，也不扩展其冻结成员。多进程锁阻止另一个 CLI 或服务同时占有同一数据库。

日志在项目 `.artifacts/appeye-service.log` 和 `.artifacts/appeye-service.error.log`；该目录及本地真实数据库不进入 Git。后台“市场动态”展示实际成功观测、周期进度及失败状态。调度开始与全部应用刷新完成分别记录，公开商店的限速、失败和日期缺失如实保留。
