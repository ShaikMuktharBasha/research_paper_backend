const app = require("./app");

const PORT = Number(process.env.PORT || 8000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Node backend running on http://localhost:${PORT}`);
});
