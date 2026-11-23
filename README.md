# 写作助教 · Writing Aide

面向高校课程论文的中英双语写作平台。教师发布作业并按评分标准批改，学生在目标设定、列提纲、起草、修改和反思五个阶段完成论文。

- 教师创建班级并分发邀请码，设置写作语言、截止时间、篇幅区间、检查清单和评分标准。
- 学生加入班级后可随时继续未提交的稿件，切换简体中文或 English 界面。正文支持分节、粗体和斜体，初稿与修订稿分别保存。
- 提交后稿件锁定。教师按评分项录入分数和评语，学生可查看已发布的成绩。
- 教师可以维护班级名单、编辑和复制作业。学生从站内通知进入成绩与反馈，查看分项评语和正文批注。
- 同班学生与任课教师可通过侧栏发送一对一文字私信。失去最后一个共同班级后，会话隐藏，恢复共同班级后可以继续查看。
- 配置模型服务后，可使用提纲反馈、修改建议和按评分标准预评。学生能记录是否采纳修改建议及理由，教师决定最终分数。
- 「我的文档」提供私有文件库，可上传 Word、PDF 和 Markdown，搜索正文、管理版本、发起指定版本的审阅和独立辅助写作。启用 ONLYOFFICE Docs 后可在桌面浏览器编辑 DOCX，移动端可查看和下载。PDF 查看器为只读。

## 本地运行

需要 Node.js 24、pnpm 12.8.1 和 PostgreSQL。先创建一个项目专用的空数据库和数据库用户，复制 `.env.example` 为 `.env.local`，填入数据库连接。运行以下命令生成一个独立的 `BETTER_AUTH_SECRET` 并填入配置文件。

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
pnpm install --frozen-lockfile
pnpm db:migrate
```

学生在登录页自行注册。教师账号由项目维护者创建。运行 `pnpm teacher:create` 前，在当前终端设置 `TEACHER_NAME`、`TEACHER_EMAIL` 和 `TEACHER_PASSWORD` 环境变量（密码至少 10 字符）。可以按需创建多个教师账号，一个邮箱对应一个账号。

升级已有首版数据库时，再运行一次 `pnpm db:migrate`。初始化管理工作台时，在本地终端设置 `ADMIN_NAME`、`ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 环境变量（密码 10–128 字符），运行一次 `pnpm admin:create`。使用尚未注册的邮箱。之后由管理员在管理工作台维护账号、班级和作业。

分别在两个终端启动服务。

```sh
pnpm dev:api
```

```sh
pnpm dev --host localhost --port 5173 --strictPort
```

打开 [http://localhost:5173](http://localhost:5173)。教师登录后先创建班级，然后发布作业。学生输入邀请码后，可以在工作台看到该班级的作业。截止时间按浏览器所在时区输入和显示。

## AI 模型服务

在 `.env.local` 中设置 `AI_BASE_URL=https://api.deepseek.com`、`AI_MODEL=deepseek-flash`，再填写自己的 `AI_API_KEY` 并重启后端。也可以选择支持 `/chat/completions` 和 `response_format: { type: "json_object" }` 的其他模型服务。[DeepSeek 更新日志](https://api-docs.deepseek.com/updates/#deepseek-v41-flash-1017-update)

用户主动请求反馈时，后端会将作业要求、评分项和对应的提纲或稿件内容发给所配置的模型服务。API 密钥只配置在后端。未配置时，师生可以照常写作、提交和人工批改。

## 私有存储与 Word

先运行 `pnpm db:migrate`。文档数据默认保存在 `document-storage/`，可用 `DOCUMENT_STORAGE` 指定应用专用目录。恢复时请将同一时间点的数据库和文件目录成套恢复。开发环境默认每个文件 25 MiB、每个账号 1 GiB，未接受的邀请 7 天到期。

`OFFICE_URL` 是浏览器和 API 都能访问的 ONLYOFFICE Docs 地址，`OFFICE_APP_URL` 是文档服务回连 API 的地址。将 `OFFICE_SECRET` 设为部署时生成的随机值，并在 Office 服务中启用同一个 JWT 密钥。部署时应配好 HTTPS、限制容器网络访问、安装试点所需中文字体，并实际验证下载、保存和回调。社区版的移动端能力按官方说明验收。 [ONLYOFFICE 安全配置](https://api.onlyoffice.com/docs/docs-api/get-started/how-it-works/security) · [移动端集成](https://api.onlyoffice.com/docs/docs-api/get-started/how-it-works/mobile-integration)

## 构建与检查

```sh
pnpm lint
pnpm format:check
pnpm test:browser:install
pnpm test
pnpm build
```

集成测试使用独立的 PostgreSQL 测试库。将 `DATABASE_URL` 和 `TEST_DATABASE_URL` 指向同一个以 `_test` 结尾的数据库，运行 `pnpm db:migrate`，再运行 `node --test --test-concurrency=1 server/course-flow.integration.ts server/documents.integration.ts`。文档测试使用临时文件目录，请为测试库关闭其他运行中的 API 实例。测试使用本地模拟模型服务。

部署时，将 `APP_ORIGIN` 设为应用的公开 HTTPS 地址，将 `NODE_ENV` 设为 `production`，运行数据库迁移后执行 `pnpm start`。Fastify 在同一个域名下提供 `dist/` 前端和 API。默认绑定 `127.0.0.1:3001`，可通过 `HOST` 和 `PORT` 配置。

前端基于 React、Vite、TanStack Router、Shadcn UI、Tiptap 和 react-i18next。后端使用 Fastify、Better Auth、Drizzle ORM 和 PostgreSQL。

## 致谢 · Credits

感谢 **Sat Naing（[@satnaing](https://github.com/satnaing)）** 开源 [Shadcn Admin](https://github.com/satnaing/shadcn-admin)。本项目在该模板的界面组件与布局基础上开发，保留了原作者的版权声明和 MIT 许可证。

Thanks to **Sat Naing** for creating and open-sourcing Shadcn Admin, the frontend template used by Writing Aide. See [LICENSE](LICENSE).
