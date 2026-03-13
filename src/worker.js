export default {

  async scheduled(event, env) {
    await collect(env)
  },

  async fetch(request, env) {

    const url = new URL(request.url)

    if (url.pathname === "/collect") {
      await collect(env)
      return new Response("collect done")
    }

    if (url.pathname === "/api/data") {
      return getData(env)
    }

    return new Response(dashboard(),{
      headers:{ "content-type":"text/html;charset=utf-8" }
    })
  }

}

async function collect(env){

  const sec_uid = env.SEC_UID

  if(!sec_uid){
    return
  }

  const url = `https://www.douyin.com/user/${sec_uid}`

  const resp = await fetch(url,{
    headers:{
      "user-agent":"Mozilla/5.0",
      "accept-language":"zh-CN"
    }
  })

  const html = await resp.text()

  const match = html.match(/<script id="SIGI_STATE" type="application\\/json">(.*?)<\\/script>/)

  if(!match){
    console.log("SIGI_STATE not found")
    return
  }

  const json = JSON.parse(match[1])

  const userModule = json.UserModule

  const userKey = Object.keys(userModule.users)[0]

  const u = userModule.users[userKey]

  const stats = userModule.stats[userKey]

  const data = {

    date:new Date().toISOString().slice(0,10),

    nickname:u.nickname,

    followers:stats.followerCount,

    following:stats.followingCount,

    aweme:stats.videoCount,

    likes:stats.diggCount

  }

  const key = `history/${data.date}.json`

  const exist = await env.R2.get(key)

  if(!exist){
    await env.R2.put(key,JSON.stringify(data))
  }

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

return \`
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
color:white;
font-family:Arial;
}

.container{
max-width:1200px;
margin:auto;
padding:40px;
}

.card{
background:#1e293b;
padding:25px;
border-radius:10px;
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

.chart{
height:320px;
}

</style>

</head>

<body>

<div class="container">

<h1>抖音账号监控</h1>

<div class="range">
<button onclick="setRange(7)">7天</button>
<button onclick="setRange(30)">30天</button>
<button onclick="setRange(90)">90天</button>
<button onclick="setRange(365)">1年</button>
<button onclick="setRange(9999)">全部</button>
</div>

<div class="card">
<div id="followersChart" class="chart"></div>
</div>

<div class="card">
<div id="likesChart" class="chart"></div>
</div>

<div class="card">
<div id="awemeChart" class="chart"></div>
</div>

</div>

<script>

let raw=[]
let range=30

async function load(){

const resp=await fetch("/api/data")

raw=await resp.json()

render()

}

function setRange(r){

range=r
render()

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

draw("followersChart","粉丝",dates,followers)
draw("likesChart","点赞",dates,likes)
draw("awemeChart","作品",dates,aweme)

}

function draw(id,name,x,data){

const chart=echarts.init(document.getElementById(id))

chart.setOption({

tooltip:{},

xAxis:{type:"category",data:x},

yAxis:{type:"value"},

series:[{
name:name,
type:"line",
smooth:true,
data:data
}]

})

}

load()

</script>

</body>

</html>
\`
}
