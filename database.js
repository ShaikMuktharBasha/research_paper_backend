let client;
let papersCollection = null;
let usersCollection = null;
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

  if (papersCollection && usersCollection) {
    return { papersCollection, usersCollection };
  }

  try {
    const MongoClient = getMongoClient();
    client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 3000,
    });
    await client.connect();
    const db = client.db("research_simplifier");
    papersCollection = db.collection("papers");
    usersCollection = db.collection("users");
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    return { papersCollection, usersCollection };
  } catch (error) {
    console.warn("MongoDB is unavailable, continuing without persistence.", error.message);
    papersCollection = null;
    usersCollection = null;
    return null;
  }
}

function getPapersCollection() {
  return papersCollection;
}

function getUsersCollection() {
  return usersCollection;
}

module.exports = {
  getPapersCollection,
  getUsersCollection,
  initDatabase,
};
