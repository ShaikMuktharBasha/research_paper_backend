let client;
let papersCollection = null;
let MongoClientClass = null;

function getMongoClient() {
  if (!MongoClientClass) {
    ({ MongoClient: MongoClientClass } = require("mongodb"));
  }

  return MongoClientClass;
}

async function initDatabase() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    return null;
  }

  if (papersCollection) {
    return papersCollection;
  }

  try {
    const MongoClient = getMongoClient();
    client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 3000,
    });
    await client.connect();
    const db = client.db("research_simplifier");
    papersCollection = db.collection("papers");
    return papersCollection;
  } catch (error) {
    console.warn("MongoDB is unavailable, continuing without persistence.", error.message);
    papersCollection = null;
    return null;
  }
}

function getPapersCollection() {
  return papersCollection;
}

module.exports = {
  getPapersCollection,
  initDatabase,
};
