/**
 * API and Exposure Ingestion Service configuration.
 * Initialises express router.
 * Opens connection to MongoDB database.
 *
 * This module was initially written for a separate project by Luka Kralj and I
 * and has been modified for the purposes of this project.
 * @author Danilo Del Busso <danilo.delbusso1@gmail.com>
 * @author Luka Kralj <luka.kralj.cs@gmail.com>
 */
const express = require("express")
require("express-async-errors")
const mongoose = require("mongoose")
const fetch = require("fetch").fetchUrl
const { logger, expressLogger } = require("./logger")
logger.info("===== STARTING SERVER =====")
const { getRoutes } = require("./routes")
const app = express()
const compression = require("compression")
let expressSwagger
if (process.env.NODE_ENV !== "production") {
  expressSwagger = require("express-swagger-generator")(app)
}
// Middleware-s
const cors = require("cors")
const helmet = require("helmet")
const { genericErrorMiddleware } = require("./errorMiddlewares")
const rateLimiter = require("express-rate-limit")({
  windowMs: 1000,
  max: 5
})

function startServer({ port = process.env.PORT || 5000 } = {}) {
  if (process.env.NODE_ENV !== "production") {
    initialiseSwagger()
  }
  app.use(rateLimiter)
  app.use(helmet())
  app.use(cors())

  //can be used by load balance to check status of the instance
  app.get("/alive", (req, res) => {
    res.status(200).send("OK")
  })

  app.use(expressLogger)

  app.use(
    compression({
      //compress all payloads unless specified
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) {
          return false
        }
        return compression.filter(req, res)
      }
    })
  )

  app.use(express.json({ limit: "100mb" }))
  app.use(express.urlencoded({ extended: true, limit: "100mb" }))

  // Prevents 304 responses / disables cache control
  app.disable("etag")

  app.use(process.env.API_PREFIX || "/api/v1/", getRoutes())

  app.use("*", (req, res) => {
    res.status(404).send("404 - Not Found")
  })

  // Connect to database
  let databaseURL = process.env.DATABASE_URL || "mongodb://mongo:27017/prj"
  if (process.env.DOCKER_ENV === "true" && process.env.DOCKER_DATABASE_URL) {
    databaseURL = process.env.DOCKER_DATABASE_URL
  }
  mongoose.connect(databaseURL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  const db = mongoose.connection

  db.on("open", () => {
    logger.info("Connected database")
    if (process.env.CACHE_ON_STARTUP === "true") {
      logger.info("Loading feature and heat-map cache.")
      //load first cache for data
      fetch(
        `http://localhost:${process.env.PORT}${process.env.API_PREFIX}wifis/patch/reloadFeatureCache`,
        { method: "PATCH" },
        (err) => {
          if (err) {
            console.log(err)
          }
        }
      )
      fetch(
        `http://localhost:${process.env.PORT}${process.env.API_PREFIX}wifis/patch/reloadHeatmapData`,
        { method: "PATCH" },
        (err) => {
          if (err) {
            console.log(err)
          }
        }
      )
    }
  })

  // Must be last
  app.use(genericErrorMiddleware)

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      logger.info(`Listening on port ${server.address().port}`)

      // this block of code turns `server.close` into a promise API
      const originalClose = server.close.bind(server)
      server.close = () => {
        return new Promise((resolveClose) => {
          originalClose(resolveClose)
        })
      }
      // resolve the whole promise with the express server
      resolve(server)
    })
  })
}

function initialiseSwagger() {
  let options = require("./swagger").options
  expressSwagger(options)
}

process.on("uncaughtException", (err, origin) => {
  logger.error(
    `Uncaught Exception: origin:${origin}, error: ${err}, trace: ${err.stack}`
  )
  logger.warn(
    `Server may be unstable after an uncaught exception. Please restart server`
  )
})

process.on("exit", (code) => {
  logger.info(`Exiting with code ${code}...`)
  console.log("\nPress Ctrl+C if using nodemon.")
})

module.exports = { startServer }
