import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { Redis } from 'ioredis';
import "dotenv/config";

const app = express();

app.use(cors());

const redis = new Redis(process.env.REDIS_CONNECTION_STRING);
const subredis = new Redis(process.env.REDIS_CONNECTION_STRING);



const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

subredis.on("message", (channel, message)=>{
  io.to(channel).emit("room-update", message)
})

subredis.on("error", (err)=>{
  console.error("error in subredis", err)
})

io.on('connection', async (socket) => {
  const { id } = socket

  socket.on("join-room", async (room: string)=>{
    console.log("user joined room", room)

    const subscribedRooms = await redis.smembers("subscribed-rooms")
    await socket.join(room)
    await redis.sadd(`rooms:${id}`, room)
    await redis.hincrby("room-connections", room, 1)

    if(!subscribedRooms.includes(room)){
      subredis.subscribe(room, async(err)=>{
        if(err){
          console.log("failed to subscribe to room", err)

        }else{
           await redis.sadd("subscribed-rooms", room)


           console.log("subscribed to room", room)
        }
      })
    }


  })

  socket.on("disconnect", async ()=>{
    const { id } = socket

    const joinedRooms = await redis.smembers(`rooms:${id}`)
    await subredis.del(`rooms:${id}`)

    joinedRooms.forEach(async (room)=>{
      const remainingConnections = await redis.hincrby("room-connections", room, -1)
      if(remainingConnections <= 0){
        await redis.hdel("room-connections", room)

        subredis.unsubscribe(room, async (err)=>{
          if(err){
            console.error("failed to unsubscribe from room", err)
          }else{
            await redis.srem("subscribed-rooms", room)
            console.log("unsubscribed from room", room)
          }
        })
      }
    })
  })
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});


