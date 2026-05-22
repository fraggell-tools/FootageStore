const b = require('bcryptjs');
console.log(b.hashSync('testpass123', 10));