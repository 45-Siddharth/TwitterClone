const express = require('express')
const app = express()
app.use(express.json())

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')

const path = require('path')
const fs = require('fs')
const dbPath = path.join(process.cwd(), 'twitterClone.db')

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

let db = null
const intializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
  } catch (e) {
    console.log(`DB Error ${e.message}`)
    process.exit(1)
  }
}
intializeDBAndServer()

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUserQuery = `
        SELECT * FROM user
        WHERE username = '${username}';
    `
  const user = await db.get(getUserQuery)
  if (user === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashPassword = await bcrypt.hash(password, 10)
      const addUserQuery = `
                INSERT INTO user(name,username,password,gender)
                VALUES(
                    '${name}',
                    '${username}',
                    '${hashPassword}',
                    '${gender}'
                );
            `
      await db.run(addUserQuery)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const getUserQuery = `
        SELECT * FROM user
        WHERE username = '${username}';
    `
  const user = await db.get(getUserQuery)
  if (user === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPassword = await bcrypt.compare(password, user.password)
    if (isPassword === true) {
      const jwtToken = await jwt.sign({username: username}, 'mySecret')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'mySecret', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserId = `
      SELECT user_id from user
      WHERE username = '${username}';
  `
  const userId = await db.get(getUserId)
  const getUserTweets = `
      SELECT u.username, t.tweet, t.date_time AS dateTime
      FROM tweet t
      JOIN follower f ON t.user_id = f.following_user_id
      JOIN user u ON f.following_user_id = u.user_id
      WHERE f.follower_user_id = ${userId.user_id}
      ORDER BY t.date_time DESC
      LIMIT 4;
  `
  function convert(ele) {
    return {
      username: `${ele.username}`,
      tweet: `${ele.tweet}`,
      dateTime: `${ele.dateTime}`,
    }
  }
  const tweets = await db.all(getUserTweets)
  response.send(tweets.map(ele => convert(ele)))
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserQuery = `
      SELECT user_id FROM user
      WHERE username='${username}';
  `
  const user_id = await db.get(getUserQuery)
  const getUserNames = `
      SELECT name FROM user INNER JOIN follower ON user.user_id = follower.following_user_id
      WHERE follower_user_id = ${user_id.user_id};
  `
  const following = await db.all(getUserNames)
  function convert(ele) {
    return {
      name: `${ele.name}`,
    }
  }
  response.send(following.map(ele => convert(ele)))
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserQuery = `
      SELECT user_id FROM user
      WHERE username='${username}';
  `
  const user_id = await db.get(getUserQuery)
  const getUserNames = `
      SELECT name FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id
      WHERE following_user_id = ${user_id.user_id};
  `
  const followers = await db.all(getUserNames)
  function convert(ele) {
    return {
      name: `${ele.name}`,
    }
  }
  response.send(followers.map(ele => convert(ele)))
})

app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserQuery = `
      SELECT user_id FROM user
      WHERE username='${username}';
  `
  const user_id = await db.get(getUserQuery)
  const {tweetId} = request.params
  const checkFollow = `
      SELECT f.follower_user_id FROM follower f
      INNER JOIN tweet t ON t.user_id = f.following_user_id
      WHERE f.follower_user_id = ${user_id.user_id} AND t.tweet_id = ${tweetId};
  `
  check = await db.get(checkFollow)
  if (check === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const tweetDetails = `
      SELECT tweet,
            (SELECT COUNT(reply_id) FROM reply WHERE tweet_id = ${tweetId}) AS rc,
            (SELECT COUNT(like_id) FROM like WHERE tweet_id = ${tweetId}) AS lc,
            date_time AS dt
      FROM tweet
      WHERE tweet_id = ${tweetId};

    `
    const tweet = await db.get(tweetDetails)
    response.send({
      tweet: tweet.tweet,
      likes: tweet.lc,
      replies: tweet.rc,
      dateTime: tweet.dt,
    })
  }
})

app.get(
  '/tweets/:tweetId/likes',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const getUser = `
        SELECT user_id from user
        WHERE username = '${username}';
    `
    const userId = await db.get(getUser)
    const checkFollow = `
        SELECT f.follower_user_id FROM follower f
        INNER JOIN tweet t ON t.user_id = f.following_user_id
        WHERE f.follower_user_id = ${userId.user_id} AND t.tweet_id = ${tweetId};
    `
    const follow = await db.get(checkFollow)
    if (follow === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const liked = `
            SELECT u.username AS likes FROM tweet t INNER JOIN like l 
            ON t.tweet_id = l.tweet_id INNER JOIN user u ON u.user_id = l.user_id
            WHERE t.tweet_id = ${tweetId};
        `
      const likes = await db.all(liked)
      let arr = []
      for (let e of likes) {
        arr.push(e.likes)
      }
      response.send({
        likes: arr,
      })
    }
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const getUser = `
        SELECT user_id FROM user
        WHERE username = '${username}';
    `
    const userId = await db.get(getUser)
    const checkFollow = `
        SELECT f.follower_user_id FROM follower f INNER JOIN tweet t
        ON t.user_id = f.following_user_id
        WHERE f.follower_user_id = ${userId.user_id} AND t.tweet_id = ${tweetId};
    `
    const follow = await db.get(checkFollow)
    if (follow === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const replies = `
            SELECT u.name,r.reply FROM tweet t INNER JOIN reply r 
            ON t.tweet_id = r.tweet_id INNER JOIN user u ON u.user_id = r.user_id
            WHERE t.tweet_id = ${tweetId};
        `
      const reply = await db.all(replies)
      response.send({
        replies: reply,
      })
    }
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUser = `
          SELECT user_id FROM user
          WHERE username = '${username}';
      `
  const userId = await db.get(getUser)
  const getTweets = `
          SELECT t.tweet,COUNT(DISTINCT l.like_id) AS likes,COUNT(DISTINCT r.reply_id) AS replies,t.date_time AS dateTime
          FROM user u INNER JOIN tweet t ON u.user_id = t.user_id INNER JOIN like l ON l.tweet_id = t.tweet_id
          INNER JOIN reply r ON r.tweet_id = t.tweet_id
          WHERE u.user_id = ${userId.user_id}
          GROUP BY t.tweet_id;
      `
  const tweets = await db.all(getTweets)
  response.send(tweets)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const {tweet} = request.body
  const getUser = `
        SELECT user_id FROM user
        WHERE username = '${username}';
    `
  const userId = await db.get(getUser)
  const date = new Date()
  const postTweet = `
          INSERT INTO tweet(tweet,user_id,date_time)
          VALUES(
              '${tweet}',
              ${userId.user_id},
              '${date.toISOString().replace('T', ' ').slice(0, 19)}'
          );
    `
  await db.run(postTweet)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const getUser = `
          SELECT user_id FROM user
          WHERE username = '${username}';
      `
    const userId = await db.get(getUser)
    const checkTweet = `
          SELECT user_id FROM tweet
          WHERE tweet_id = ${tweetId};
      `
    const tweetUserId = await db.get(checkTweet)
    if (userId.user_id !== tweetUserId.user_id) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteTweet = `
              DELETE FROM tweet
              WHERE tweet_id = ${tweetId};
          `
      await db.run(deleteTweet)
      response.send('Tweet Removed')
    }
  },
)
module.exports = app
