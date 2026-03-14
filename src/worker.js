export default {

 async scheduled(event, env) {
  // 定时任务不需要密码校验
  await collect(env)
 },

 async fetch(request, env) {

  const url = new URL(request.url)

  // 1. PWA 必需的公开文件（不能加锁，否则手机端无法安装）
  if (url.pathname === "/manifest.json") return await getManifest(env)
  if (url.pathname === "/sw.js") return getServiceWorker()

  // 2. 核心功能路由（加锁保护，改用 Cookie 校验）
  if (!checkAuthCookie(request, env)) {
    // 拦截登录请求
    if (url.pathname === "/login" && request.method === "POST") {
        return handleLogin(request, env);
    }
    // 未登录时返回漂亮的登录页面
    return new Response(loginPage(), {
        headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  if (url.pathname === "/collect") {
   return collect(env) 
  }

  // 增加强制重建缓存的后门路由
  if (url.pathname === "/api/build") {
   await buildCache(env)
   return new Response("Cache Rebuilt Success")
  }

  // API 路由现在接收 request 参数以处理 ?days=30 按需加载
  if (url.pathname === "/api/data") {
   return getData(request, env)
  }

  if (url.pathname === "/debug") {
   return debug(env)
  }

  return new Response(dashboard(),{
   headers:{ "content-type":"text/html; charset=utf-8"}
  })

 }

}

// ==== 身份验证逻辑 (Cookie版) ====
function checkAuthCookie(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const expectedPass = env.ADMIN_PASS || "123456"; 
  return cookie.includes(`auth=${expectedPass}`);
}

async function handleLogin(request, env) {
  const formData = await request.formData().catch(() => null);
  const pass = formData ? formData.get("password") : "";
  const expectedPass = env.ADMIN_PASS || "123456";
  
  if (pass === expectedPass) {
      return new Response("Login Success", {
          status: 302,
          headers: {
              "Location": "/",
              "Set-Cookie": `auth=${pass}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Strict`
          }
      });
  } else {
      return new Response(loginPage("密码错误，请重试"), {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8" }
      });
  }
}

function loginPage(errorMsg = "") {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>登录 - 数据中心</title>
      <style>
          body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .login-box { background: #1e293b; padding: 40px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); width: 100%; max-width: 320px; text-align: center; }
          h2 { margin-top: 0; margin-bottom: 24px; color: #3b82f6; }
          input[type="password"] { width: 100%; padding: 14px; margin-bottom: 16px; border: 1px solid #334155; border-radius: 8px; background: #0f172a; color: white; box-sizing: border-box; outline: none; font-size: 16px; transition: border-color 0.2s; }
          input[type="password"]:focus { border-color: #3b82f6; }
          button { width: 100%; padding: 14px; border: none; border-radius: 8px; background: #3b82f6; color: white; font-size: 16px; font-weight: bold; cursor: pointer; transition: background 0.3s; }
          button:hover { background: #2563eb; }
          .error { color: #ef4444; font-size: 14px; margin-bottom: 16px; min-height: 20px; }
      </style>
  </head>
  <body>
      <div class="login-box">
          <h2>安全验证</h2>
          <div class="error">${errorMsg}</div>
          <form action="/login" method="POST">
              <input type="password" name="password" placeholder="请输入访问密码" required autofocus>
              <button type="submit">进入控制台</button>
          </form>
      </div>
  </body>
  </html>`;
}

async function douyinRequest(sec_uid){
 const api = `https://www.iesdouyin.com/web/api/v2/user/info/?sec_uid=${sec_uid}&aid=6383`
 const resp = await fetch(api,{
  headers:{
   "accept":"application/json, text/plain, */*",
   "accept-language":"zh-CN,zh;q=0.9",
   "referer":"https://www.douyin.com/",
   "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  }
 })
 const buffer = await resp.arrayBuffer()
 return new TextDecoder("utf-8").decode(buffer)
}

// ==== 数据读写分离缓存构建逻辑 ====
async function buildCache(env) {
  if(!env.R2) return [];
  const list = await env.R2.list({ prefix: "history/" });
  const arr = [];
  for (const obj of list.objects) {
    if (obj.key === 'history/all.json') continue;
    const file = await env.R2.get(obj.key);
    if(file) arr.push(await file.json());
  }
  arr.sort((a, b) => a.date.localeCompare(b.date));
  
  if (arr.length > 0) {
    await env.R2.put('history/all.json', JSON.stringify(arr));
  }
  return arr;
}

async function collect(env, debug=false){
 try {
  const text = await douyinRequest(env.SEC_UID)

  if(debug){
   return new Response(text,{ headers:{ "content-type":"text/plain; charset=utf-8"} })
  }

  let json;
  try { json = JSON.parse(text) } catch(e) {
    return new Response("JSON解析失败！返回原文：\n" + text, { status: 500 })
  }

  if(!json || !json.user_info){
    return new Response("数据格式异常！找不到 user_info。返回原文：\n" + text, { status: 500 })
  }

  const u = json.user_info
  const beijingTime = new Date(Date.now() + 8 * 3600 * 1000)
  const dateStr = beijingTime.toISOString().slice(0, 10)

  const data = {
   date: dateStr,
   nickname: u.nickname || "未知昵称",
   signature: u.signature || "",
   avatar: u.avatar_larger?.url_list?.[0] || u.avatar_medium?.url_list?.[0] || u.avatar_thumb?.url_list?.[0] || "",
   followers: Number(u.mplatform_followers_count || u.follower_count || 0),
   following: Number(u.following_count || 0),
   aweme: Number(u.aweme_count || 0),
   favoriting: Number(u.favoriting_count || 0),
   likes: Number(u.total_favorited || 0)
  }

  if(!env.R2) return new Response("Worker 环境变量错误：没有找到 env.R2", { status: 500 })

  // 【优化3】：彻底解决文件读写锁竞争。collect 阶段只原子的写入当天的独立文件
  const dailyKey = `history/${data.date}.json`
  await env.R2.put(dailyKey, JSON.stringify(data))

  // 然后调用后台路由，遍历所有独立文件重建视图缓存，确保 all.json 数据百分百准确
  await buildCache(env)

  return new Response("collect ok")

 } catch (err) {
   return new Response("Worker 内部致命报错: " + err.message + "\n" + err.stack, { status: 500 })
 }
}

async function getData(request, env){
  // 【优化5】：按需加载。提取天数范围，默认请求30天
  const url = new URL(request.url);
  const daysStr = url.searchParams.get("days") || "30";
  const days = parseInt(daysStr, 10);

  const allFile = await env.R2.get("history/all.json")
  let arr = [];
  
  if (allFile) {
    arr = await allFile.json()
  } else {
    // 缓存丢失则即刻重建
    arr = await buildCache(env)
  }

  // 服务端完成数据切割以节省带宽
  let resData = arr;
  if (days !== 9999 && arr.length > days) {
      resData = arr.slice(-days);
  }

  return new Response(JSON.stringify(resData),{
   headers:{ "content-type":"application/json; charset=utf-8", "Access-Control-Allow-Origin":"*" }
  })
}

async function debug(env){
 const text = await douyinRequest(env.SEC_UID)
 return new Response(text,{ headers:{ "content-type":"text/plain; charset=utf-8"} })
}

async function getManifest(env) {
 let avatarUrl = "https://ui-avatars.com/api/?name=DY&background=3b82f6&color=fff&size=192"; 
 let appName = "数据中心"; // 默认名字

 try {
   if (env && env.R2) {
     const allFile = await env.R2.get("history/all.json");
     if (allFile) {
       const allData = await allFile.json();
       if (allData.length > 0) {
           const last = allData[allData.length - 1];
           if (last.avatar) avatarUrl = last.avatar;
           // 【更新】：将用户的昵称用作 PWA 的 App 名字
           if (last.nickname) appName = last.nickname;
       }
     }
   }
 } catch (e) {
   console.error("动态获取PWA信息失败", e);
 }

 const manifest = {
  name: appName, short_name: appName, start_url: "/", display: "standalone",
  background_color: "#0f172a", theme_color: "#0f172a", description: "个人抖音账号数据追踪面板",
  icons: [
   { src: avatarUrl, sizes: "192x192", type: "image/png" },
   { src: avatarUrl, sizes: "512x512", type: "image/png" }
  ]
 }
 return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json; charset=utf-8" } })
}

// 【优化2】：增强型 Service Worker，支持静态资源离线缓存
function getServiceWorker() {
 const sw = `
  const CACHE_NAME = 'dy-monitor-v2';
  const ASSETS = [
      '/',
      '/manifest.json',
      'https://registry.npmmirror.com/echarts/5.5.0/files/dist/echarts.min.js'
  ];

  self.addEventListener('install', (e) => { 
      e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
      self.skipWaiting(); 
  });
  
  self.addEventListener('fetch', (e) => { 
      const url = new URL(e.request.url);
      
      // 核心 API 不走缓存，确保数据实时性
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/collect')) {
          e.respondWith(fetch(e.request));
          return;
      }

      // 静态资源使用 Network First 策略，断网时 fallback 到缓存
      e.respondWith(
          fetch(e.request)
          .then(res => {
              const resClone = res.clone();
              caches.open(CACHE_NAME).then(c => c.put(e.request, resClone));
              return res;
          })
          .catch(() => caches.match(e.request).then(cachedRes => cachedRes || new Response("网络连接已断开")))
      );
  });
 `
 return new Response(sw, { headers: { "content-type": "application/javascript; charset=utf-8" } })
}

function dashboard(){
return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Douyin Monitor</title>

<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#0f172a">
<link rel="apple-touch-icon" href="https://ui-avatars.com/api/?name=DY&background=3b82f6&color=fff&size=192">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">

<script src="https://registry.npmmirror.com/echarts/5.5.0/files/dist/echarts.min.js"></script>
<style>
:root {
    --bg: #0f172a; --panel: #1e293b; --text-main: #f8fafc; --text-muted: #94a3b8;
    --accent: #3b82f6; --accent-hover: #2563eb; --border: #334155; --success: #10b981;
}

body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text-main); padding: 20px; -webkit-tap-highlight-color: transparent;
}

.container { max-width: 1200px; margin: 0 auto; }

#loading-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: var(--bg); z-index: 9999;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    transition: opacity 0.4s ease;
}
.spinner {
    width: 48px; height: 48px; border: 4px solid var(--border); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.header { margin-bottom: 30px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.header h2 { margin: 0; font-size: 1.8rem; font-weight: 600; }

.profile-card {
    background: var(--panel); border-radius: 16px; padding: 24px; display: flex;
    align-items: center; gap: 24px; margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}
.avatar { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid var(--border); }
.profile-info h3 { margin: 0 0 8px 0; font-size: 1.4rem; }
.signature { font-size: 0.95rem; color: var(--text-muted); line-height: 1.5; white-space: pre-wrap; }

.stats-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 16px; margin-bottom: 24px;
}
.stat-card {
    background: var(--panel); padding: 20px 16px; border-radius: 16px; text-align: center;
    transition: transform 0.2s ease; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}
.stat-card:hover { transform: translateY(-4px); }
.stat-card .label { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 8px; }
.stat-card .value { font-size: 1.5rem; font-weight: 700; margin: 0; color: var(--accent); }

.controls-wrapper {
    background: var(--panel); padding: 16px; border-radius: 16px; margin-bottom: 24px;
    display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: center;
}
.control-group { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.control-label { color: var(--text-muted); font-size: 0.9rem; margin-right: 4px; }

.btn {
    background: transparent; color: var(--text-muted); border: 1px solid var(--border);
    padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; transition: all 0.2s;
}
.btn:hover { background: var(--border); color: var(--text-main); }
.btn.active { background: var(--accent); color: white; border-color: var(--accent); }
.btn-export { border-color: #475569; color: #cbd5e1; }
.btn-export:hover { background: #334155; border-color: #94a3b8; }

.charts-layout { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
.chart-wrapper { background: var(--panel); border-radius: 16px; padding: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
.chart { height: 320px; width: 100%; }

@media (max-width: 768px) {
    body { padding: 12px; }
    .charts-layout { grid-template-columns: 1fr; }
    .profile-card { flex-direction: column; text-align: center; padding: 20px; }
    .controls-wrapper { flex-direction: column; align-items: flex-start; }
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .chart { height: 280px; }
}
</style>
</head>
<body>

<div id="loading-overlay">
    <div class="spinner"></div>
    <div style="color: var(--text-muted);">正在加载核心数据...</div>
</div>

<div class="container">
    <div class="header" style="display: flex; justify-content: space-between; align-items: center;">
        <h2 id="app-title">数据中心</h2>
        <div class="control-group">
            <button class="btn btn-export" onclick="exportData('csv')">导出 CSV</button>
            <button class="btn btn-export" onclick="exportData('json')">导出 JSON</button>
        </div>
    </div>

    <div class="profile-card">
        <img id="avatar" class="avatar" src="" alt="Avatar">
        <div class="profile-info">
            <h3 id="nickname">-</h3>
            <div id="signature" class="signature">-</div>
        </div>
    </div>

    <div class="stats-grid">
        <div class="stat-card"><div class="label">粉丝总数</div><div class="value" id="followers">-</div></div>
        <div class="stat-card"><div class="label">关注数</div><div class="value" id="following">-</div></div>
        <div class="stat-card"><div class="label">作品数</div><div class="value" id="aweme">-</div></div>
        <div class="stat-card"><div class="label">获赞总数</div><div class="value" id="likes">-</div></div>
        <div class="stat-card"><div class="label">喜欢/点赞</div><div class="value" id="favoriting">-</div></div>
        <div class="stat-card"><div class="label">今日涨粉</div><div class="value" id="today">0</div></div>
    </div>

    <div class="controls-wrapper">
        <div class="control-group">
            <span class="control-label">指标：</span>
            <button class="btn m-btn active" onclick="setMetric('followers', this)">粉丝</button>
            <button class="btn m-btn" onclick="setMetric('following', this)">关注</button>
            <button class="btn m-btn" onclick="setMetric('aweme', this)">作品</button>
            <button class="btn m-btn" onclick="setMetric('likes', this)">获赞</button>
            <button class="btn m-btn" onclick="setMetric('favoriting', this)">喜欢</button>
        </div>
        
        <div class="control-group">
            <span class="control-label">范围：</span>
            <button class="btn r-btn" onclick="setRange(7, this)">7天</button>
            <button class="btn r-btn active" onclick="setRange(30, this)">30天</button>
            <button class="btn r-btn" onclick="setRange(90, this)">90天</button>
            <button class="btn r-btn" onclick="setRange(365, this)">一年</button>
            <button class="btn r-btn" onclick="setRange(9999, this)">全部</button>
        </div>
    </div>

    <div class="charts-layout">
        <div class="chart-wrapper"><div id="trendChart" class="chart"></div></div>
        <div class="chart-wrapper"><div id="changeChart" class="chart"></div></div>
    </div>

    <div class="history-table-wrapper" style="margin-top: 24px; background: var(--panel); border-radius: 16px; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); overflow-x: auto;">
        <h3 style="margin-top:0; font-size: 1.2rem; margin-bottom: 16px;">个人资料变更历史</h3>
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
            <thead>
                <tr style="border-bottom: 1px solid var(--border); color: var(--text-muted);">
                    <th style="padding: 12px 8px;">记录日期</th>
                    <th style="padding: 12px 8px;">头像</th>
                    <th style="padding: 12px 8px;">昵称</th>
                    <th style="padding: 12px 8px;">签名</th>
                </tr>
            </thead>
            <tbody id="historyTbody"></tbody>
        </table>
    </div>
</div>

<script>
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}

let raw = [];
let currentRange = 30;
let loadedRange = 0; // 记录目前已经从后端拉取的数据天数
let currentMetric = 'followers';

const metricNames = {
    followers: '粉丝总数', following: '关注数', aweme: '发布作品数',
    likes: '获赞总数', favoriting: '喜欢/点赞数'
};

async function load(days) {
    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('loading-overlay').style.opacity = '1';

    try {
        const resp = await fetch("/api/data?days=" + days);
        raw = await resp.json();
        loadedRange = days;
        if(raw.length > 0) {
            updateStats();
            render();
            renderHistoryTable();
        }
    } catch (e) {
        console.error("加载数据失败:", e);
    } finally {
        const overlay = document.getElementById('loading-overlay');
        overlay.style.opacity = '0';
        setTimeout(() => overlay.style.display = 'none', 400);
    }
}

function renderHistoryTable() {
    const tbody = document.getElementById("historyTbody");
    tbody.innerHTML = "";
    const reversed = [...raw].reverse();
    
    let html = "";
    let prev = null;
    let count = 0; 
    const MAX_ROWS = 5; 
    
    for (const item of reversed) {
        if (count >= MAX_ROWS) break; 
        if (!prev || prev.nickname !== item.nickname || prev.signature !== item.signature || prev.avatar !== item.avatar) {
            html += \`
            <tr style="border-bottom: 1px solid #334155;">
                <td style="padding: 12px 8px; color: #94a3b8; white-space: nowrap;">\${item.date}</td>
                <td style="padding: 12px 8px;"><img src="\${item.avatar || ''}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border);"></td>
                <td style="padding: 12px 8px; font-weight: 500;">\${item.nickname || '-'}</td>
                <td style="padding: 12px 8px; max-width: 300px; color: #cbd5e1;">\${(item.signature || '-').replace(/\\n/g, '<br>')}</td>
            </tr>\`;
            prev = item;
            count++;
        }
    }
    tbody.innerHTML = html;
}

function setRange(r, btnEl) {
    currentRange = r;
    document.querySelectorAll('.r-btn').forEach(btn => btn.classList.remove('active'));
    if(btnEl) btnEl.classList.add('active');

    // 【优化5】：如果请求的范围大于当前加载的范围，才去服务器拿新数据
    if (currentRange > loadedRange) {
        load(currentRange);
    } else {
        render(); // 本地数据直接截取重绘
    }
}

function setMetric(m, btnEl) {
    currentMetric = m;
    document.querySelectorAll('.m-btn').forEach(btn => btn.classList.remove('active'));
    if(btnEl) btnEl.classList.add('active');
    render();
}

function updateStats() {
    const last = raw[raw.length - 1];

    document.getElementById("avatar").src = last.avatar || '';
    
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if(appleIcon) appleIcon.href = last.avatar || 'https://ui-avatars.com/api/?name=DY&background=3b82f6&color=fff&size=192';

    const nickNameText = last.nickname || '未知';
    document.getElementById("nickname").innerText = nickNameText;
    document.title = nickNameText + "的面板"; // 更新页面 Title
    document.getElementById("app-title").innerText = nickNameText + "的数据"; // 更新页面顶栏
    
    document.getElementById("signature").innerText = last.signature || '暂无签名';
    
    document.getElementById("followers").innerText = format(last.followers);
    document.getElementById("following").innerText = format(last.following);
    document.getElementById("aweme").innerText = format(last.aweme);
    document.getElementById("likes").innerText = format(last.likes);
    document.getElementById("favoriting").innerText = format(last.favoriting);

    if (raw.length > 1) {
        const prev = raw[raw.length - 2];
        const diff = last.followers - prev.followers;
        const todayEl = document.getElementById("today");
        todayEl.innerText = diff > 0 ? '+' + diff : diff;
        todayEl.style.color = diff > 0 ? '#10b981' : (diff < 0 ? '#ef4444' : 'var(--accent)');
    }
}

function render() {
    let data = [...raw];
    if (currentRange !== 9999 && data.length > currentRange) {
        data = data.slice(-currentRange);
    }

    const dates = data.map(i => i.date);
    const metricData = data.map(i => i[currentMetric]);
    
    const changeData = [];
    for (let i = 1; i < data.length; i++) {
        changeData.push(data[i][currentMetric] - data[i - 1][currentMetric]);
    }

    const mName = metricNames[currentMetric];

    drawChart("trendChart", dates, metricData, mName + "趋势", '#3b82f6');
    drawChart("changeChart", dates.slice(1), changeData, "每日" + mName + "增减", '#10b981');
}

function drawChart(id, xData, yData, title, colorStr) {
    const dom = document.getElementById(id);
    let chart = echarts.getInstanceByDom(dom);
    if (!chart) chart = echarts.init(dom);

    chart.setOption({
        title: { text: title, textStyle: { color: '#e2e8f0', fontSize: 15, fontWeight: 'normal' } },
        // 【优化4】：加入 confine: true，防止 tooltip 在手机端被截断
        tooltip: { trigger: 'axis', confine: true, backgroundColor: 'rgba(30, 41, 59, 0.9)', borderColor: '#334155', textStyle: { color: '#f8fafc' } },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: "category", data: xData, axisLabel: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#334155' } } },
        yAxis: { type: "value", axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#334155', type: 'dashed' } }, minInterval: 1 },
        series: [{
            type: "line", smooth: true, data: yData, symbolSize: 6, itemStyle: { color: colorStr },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: colorStr + '80' }, { offset: 1, color: colorStr + '00' }  
                ])
            }
        }]
    });
    window.addEventListener('resize', () => chart.resize());
}

function format(n) {
    if(n === undefined || n === null) return 0;
    if (n >= 100000000) return (n / 100000000).toFixed(2) + " 亿";
    if (n >= 10000) return (n / 10000).toFixed(2) + " 万";
    return n.toLocaleString(); 
}

function exportData(type) {
    if(!raw || raw.length === 0) return alert("暂无数据可导出");
    let content, mime, filename;

    if (type === 'csv') {
        content = "\\uFEFF日期,昵称,签名,头像URL,粉丝总数,关注数,作品数,获赞总数,喜欢点赞数\\n"; 
        raw.forEach(r => {
            const safeNickname = \`"\${(r.nickname || '').replace(/"/g, '""')}"\`;
            const safeSignature = \`"\${(r.signature || '').replace(/"/g, '""').replace(/\\n/g, ' ')}"\`;
            
            content += \`\${r.date},\${safeNickname},\${safeSignature},\${r.avatar || ''},\${r.followers},\${r.following},\${r.aweme},\${r.likes},\${r.favoriting}\\n\`;
        });
        mime = "text/csv;charset=utf-8;";
        filename = "douyin_monitor_data.csv";
    } else {
        content = JSON.stringify(raw, null, 2);
        mime = "application/json";
        filename = "douyin_monitor_data.json";
    }

    const blob = new Blob([content], { type: mime });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 初始化时默认加载 30 天的数据
load(30);
</script>
</body>
</html>`
}
