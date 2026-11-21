# Anon Player

浏览器里的扫雷录像播放器。支持本地 EVF、AVF、MVF、RMV 文件和 OpenMS 在线录像，提供统一可编辑计数器、命名音效配置与带背景音乐的 MP4 导出。录像和用户音频都在浏览器里处理。

## 本地运行

使用 Node.js 24。项目运行在浏览器中，无需后端服务。

```sh
npm ci
npm run dev
```

访问终端给出的地址。中央播放区可选择或拖入本地录像。顶栏可导入本地录像，或点击「打开 OpenMS 录像」输入 ID（如 `107`）或 [录像链接](https://openms.top/#/video/107)。播放控件右侧的「关闭录像」可返回空白播放区。

「导出 MP4」可合并多局录像、调整顺序和末帧停留时间。背景音乐可选预设或本地文件，下载进度和解码状态显示在导出面板标题栏下方。取消或读取失败时保留上一次成功选择的音乐。导出需要支持 H.264 和 AAC 编码的浏览器，生成后点击「下载 MP4」保存。

视频默认使用 1920×1080、60 fps、10 Mbps。可选用 720p、1080p、1440p、4K 预设，也可独立调整宽度、高度、帧率和视频目标码率。宽高须为正偶数，支持的参数组合取决于浏览器的 H.264 编码能力。

在「数据」面板可编辑、删除计数器，也可拖动手柄排序，或聚焦手柄后按上下方向键。「开发者模式」可批量编辑 `["名称", "表达式"]` 数组，保存 `[]` 可清空。「恢复默认计数器」会替换当前列表和顺序。播放器和 MP4 共用计数器配置。

表达式支持数字、字符串、字段、括号及 `+`、`-`、`*`、`/`、`%`、`**`。用 `||` 拼接文本，用 `roundTo(value, digits)` 保留 0–6 位小数，例如 `roundTo(100 * bbbv_solved / bbbv, 2) || "%"`。

「音效」面板可试听、导入和编排素材，并分别调整总音量、组音量和单条音量。录像自然播完时播放结束提示音。整套设置和本地音频可命名保存，同名保存会更新配置，新名称会另存。「恢复默认音效」会把当前工作设置换成项目预设，已命名的配置可继续使用。

## 配置预设

- 在 [src/counters.ts](src/counters.ts) 的 `defaultCounterRows` 修改首次打开时的计数器。每行是 `[名称, 表达式]`。已有浏览器优先读取已保存的配置。
- 在 [src/defaultSoundProfile.ts](src/defaultSoundProfile.ts) 修改「默认配置」。把文件放进 `public/sounds/profiles/default/`，用 `{ id, name, path }` 登记，再把素材 ID 填入组的 `ids`。固定模式使用 `fixedId`，随机模式使用 `random`，顺序模式使用 `sequence`。轮播顺序与 `ids` 一致。音量取值为 0 到 1。
- 在 [src/musicTracks.ts](src/musicTracks.ts) 按下拉框显示顺序登记 `{ id, name, path }`，曲目文件放进 `public/audio/music/`。

音频条目使用唯一的 `id`，`path` 相对于对应素材目录，子目录用 `/` 分隔。默认音效读取或解码失败时回退到内置音效。

## 构建与部署

```sh
npm test
npm run build
```

`build` 检查 Vue 和 TypeScript 类型后输出 `dist/`。通过 HTTPS 提供该目录的全部内容，WASM 应返回 `application/wasm`。构建采用相对资源路径，支持域名根目录和以 `/` 结尾的子路径。

实现细节见 [开发文档](开发文档.md)，操作触发和回放验收见 [扫雷鼠标操作规范](扫雷鼠标操作规范.md)。

## 浏览器回归

构建后，安装测试用的 Chromium 并启动预览：

```sh
npx playwright install chromium
npm run preview -- --host 127.0.0.1 --port 4190 --strictPort
```

在另一终端运行 `npm run test:browser`，检查计数器布局、键盘操作、拖动排序和音效配置事务。可用 `ANON_PLAYER_CHROMIUM` 指定浏览器可执行文件，用 `ANON_PLAYER_URL` 覆盖预览地址。

## 许可

项目自有源码和文档采用 [MIT 许可](LICENSE)。预设背景音乐、默认音效和站点图标随站点源码提供，复用这些素材请遵循各自的权利条款。第三方依赖适用各自的许可，构建产物的 `licenses/` 保留相应声明。
