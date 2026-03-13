export default {

  async scheduled(event, env) {
    await collect(env)
  },

  async fetch(request, env) {

    const url = new URL(request.url)

    if (url.pathname === "/api/data") {
      return getData(env)
    }

    return new Response(dashboard(), {
      headers: { "content-type": "text/html;charset=UTF-8" }
    })
  }
}

async function collect(env){

  const sec_uid = env.SEC_UID

  if(!sec_uid){
    return new Response("SEC_UID not set")
  }

  const api =
  `https://www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=${sec_uid}&device_platform=webapp&aid=6383`

  const resp = await fetch(api,{
    headers:{
      "user-agent":"Mozilla/5.0"
    }
  })

  const json = await resp.json()

  if(!json.user){
    return
  }

  const u = json.user

  const data = {

    date:new Date().toISOString().slice(0,10),

    nickname:u.nickname,

    followers:u.follower_count,

    following:u.following_count,

    aweme:u.aweme_count,

    likes:u.total_favorited

  }

  const key = `history/${data.date}.json`

  await env.R2.put(key,JSON.stringify(data))
}

async function getData(env){

  const list = await env.R2.list({
    prefix:"history/"
  })

  const result=[]

  for(const obj of list.objects){

    const file = await env.R2.get(obj.key)

    const json = await file.json()

    result.push(json)
  }

  result.sort((a,b)=>a.date.localeCompare(b.date))

  return new Response(JSON.stringify(result),{
    headers:{
      "content-type":"application/json",
      "Access-Control-Allow-Origin":"*"
    }
  })
}

function dashboard(){

return `
<!DOCTYPE html>
<html>
<head>

<meta charset="utf-8">

<title>Douyin Analytics</title>

<script src="https://cdn.jsdelivr.net/npm/echarts@5"></script>

<style>

body{
margin:0;
background:#0f172a;
font-family:Inter,Arial;
color:white;
}

.container{
max-width:1200px;
margin:auto;
padding:40px;
}

.card{
background:#1e293b;
padding:25px;
border-radius:12px;
margin-bottom:25px;
}

.stats{
display:flex;
gap:40px;
flex-wrap:wrap;
}

.stat{
font-size:18px;
}

.range{
margin-bottom:20px;
}

.range button{
background:#334155;
border:none;
padding:8px 14px;
margin-right:10px;
border-radius:6px;
color:white;
cursor:pointer;
}

.range button:hover{
background:#475569;
}

.chart{
height:350px;
}

</style>

</head>

<body>

<div class="container">

<h1>抖音账号数据分析</h1>

<div class="card">

<div class="stats">

<div class="stat">昵称<br><b id="nickname"></b></div>

<div class="stat">粉丝<br><b id="followers"></b></div>

<div class="stat">关注<br><b id="following"></b></div>

<div class="stat">作品<br><b id="aweme"></b></div>

<div class="stat">点赞<br><b id="likes"></b></div>

</div>

</div>

<div class="range">

<button onclick="setRange(7)">7天</button>
<button onclick="setRange(30)">30天</button>
<button onclick="setRange(90)">90天</button>
<button onclick="setRange(365)">1年</button>
<button onclick="setRange(9999)">全部</button>

</div>

<div class="card">
<h2>粉丝趋势</h2>
<div id="followersChart" class="chart"></div>
</div>

<div class="card">
<h2>日新增粉丝</h2>
<div id="growthChart" class="chart"></div>
</div>

<div class="card">
<h2>点赞趋势</h2>
<div id="likesChart" class="chart"></div>
</div>

<div class="card">
<h2>作品数量趋势</h2>
<div id="awemeChart" class="chart"></div>
</div>

</div>

<script>

let raw=[]
let range=30

async function load(){

const resp=await fetch("/api/data")

raw=await resp.json()

if(raw.length===0)return

updateStats()

render()

}

function setRange(r){

range=r

render()

}

function updateStats(){

const last=raw[raw.length-1]

document.getElementById("nickname").innerText=last.nickname
document.getElementById("followers").innerText=last.followers
document.getElementById("following").innerText=last.following
document.getElementById("aweme").innerText=last.aweme
document.getElementById("likes").innerText=last.likes

}

function render(){

let data=[...raw]

if(range!==9999){
data=data.slice(-range)
}

const dates=data.map(i=>i.date)

const followers=data.map(i=>i.followers)

const likes=data.map(i=>i.likes)

const aweme=data.map(i=>i.aweme)

const growth=[]

for(let i=1;i<data.length;i++){
growth.push(data[i].followers-data[i-1].followers)
}

drawChart("followersChart",dates,followers)

drawChart("likesChart",dates,likes)

drawChart("awemeChart",dates,aweme)

drawChart("growthChart",dates.slice(1),growth)

}

function drawChart(id,x,data){

const chart=echarts.init(document.getElementById(id))

chart.setOption({

tooltip:{},

xAxis:{type:"category",data:x},

yAxis:{type:"value"},

series:[{
data:data,
type:"line",
smooth:true,
areaStyle:{}
}]

})

}

load()

</script>

</body>

</html>
`
}
