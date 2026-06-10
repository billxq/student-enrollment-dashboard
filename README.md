# 学籍看板

## 启动

```bash
node dashboard-web/server.mjs
```

默认访问地址：

```text
http://localhost:4173
```

默认账号：

- 用户名：`admin`
- 密码：`111111`

## 运行时配置

项目根目录放一个 `.env`：

```env
PORT=4173
DATA_PASSPHRASE=你的解密密钥
```

## 新增学年度数据

当 2026 学年度开始后，建议这样更新：

1. 在本地准备好新的 Excel 文件
2. 执行导入脚本

```bash
node scripts/import-year.mjs .\2026年度.xlsx --year 2026学年度
```

脚本会自动做这些事：

- 读取新 Excel
- 把原文件归档到 `archive/2026学年度/`
- 更新 `dashboard-web/data.sealed.json`
- 保留 2025 学年度等旧数据

## 以后要记住的原则

- 本地可以保留原始 Excel
- GitHub 不要再上传明文 Excel
- 仓库里只保留代码和加密后的数据文件
- 如果你更新了新学年度，重新跑一次导入脚本即可
