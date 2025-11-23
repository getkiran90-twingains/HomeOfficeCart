// server.js (only the changes shown below)
require('dotenv').config();
const express = require('express');
const { sequelize } = require('./db'); // 👉 import from db.js

const app = express();
app.use(express.json());


async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('Connected to Neon PostgreSQL successfully.');
  } catch (err) {
    console.error('Unable to connect to the database:', err.message);
  }
}
testConnection();

const { syncModels, Product, Customer, Order, OrderItem } = require('./models');

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'HomeOfficeCart API is running.' });
});

// Get all products
app.get('/products', async (req, res) => {
  try {
    const products = await Product.findAll();
    res.json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

async function getOrCreateCart(customerId) {
  //  auto-create customer if not exists
  let customer = await Customer.findByPk(customerId);
  if (!customer) {
    customer = await Customer.create({
      customer_id: customerId,
      first_name: 'Test',
      last_name: 'Customer',
      email: `test${customerId}@example.com`
    });
  }

  let cart = await Order.findOne({
    where: { customer_id: customerId, status: 'CART' }
  });

  if (!cart) {
    cart = await Order.create({ customer_id: customerId, status: 'CART', total_amount: 0 });
  }
  return cart;
}

// Add product to cart
app.post('/cart/:customerId/add', async (req, res) => {
  const { customerId } = req.params;
  const { productId, quantity } = req.body;

  try {
    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const cart = await getOrCreateCart(customerId);

    // Check if item already in cart
    let item = await OrderItem.findOne({
      where: { order_id: cart.order_id, product_id: productId }
    });

    if (item) {
      item.quantity += quantity;
      await item.save();
    } else {
      item = await OrderItem.create({
        order_id: cart.order_id,
        product_id: productId,
        quantity,
        price: product.price
      });
    }

    // Recalculate total
    const items = await OrderItem.findAll({ where: { order_id: cart.order_id } });
    const total = items.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0);
    cart.total_amount = total;
    await cart.save();

    res.json({ message: 'Item added to cart', cart_id: cart.order_id });
  } catch (err) {
    console.error('Error adding to cart:', err);
    res.status(500).json({ error: 'Failed to add item to cart' });
  }
});

// Remove product from cart
app.delete('/cart/:customerId/remove/:productId', async (req, res) => {
  const { customerId, productId } = req.params;

  try {
    const cart = await Order.findOne({ where: { customer_id: customerId, status: 'CART' } });
    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    const item = await OrderItem.findOne({
      where: { order_id: cart.order_id, product_id: productId }
    });

    if (!item) return res.status(404).json({ error: 'Item not found in cart' });

    await item.destroy();

    // Recalculate total
    const items = await OrderItem.findAll({ where: { order_id: cart.order_id } });
    const total = items.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0);
    cart.total_amount = total;
    await cart.save();

    res.json({ message: 'Item removed from cart' });
  } catch (err) {
    console.error('Error removing from cart:', err);
    res.status(500).json({ error: 'Failed to remove item from cart' });
  }
});

// List cart items
app.get('/cart/:customerId', async (req, res) => {
  const { customerId } = req.params;

  try {
    const cart = await Order.findOne({ 
      where: { customer_id: customerId, status: 'CART' },
      include: [{ model: OrderItem, include: [Product] }]
    });

    if (!cart) {
      return res.json({ items: [], total_amount: 0 });
    }

    res.json({
      cart_id: cart.order_id,
      total_amount: cart.total_amount,
      items: cart.OrderItems
    });
  } catch (err) {
    console.error('Error fetching cart:', err);
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

// Checkout - convert CART to PLACED
app.post('/orders/:customerId/checkout', async (req, res) => {
  const { customerId } = req.params;

  try {
    const cart = await Order.findOne({ 
      where: { customer_id: customerId, status: 'CART' },
      include: [OrderItem]
    });

    if (!cart || !cart.OrderItems || cart.OrderItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    cart.status = 'PLACED';
    await cart.save();

    res.json({ message: 'Order placed successfully', order_id: cart.order_id });
  } catch (err) {
    console.error('Error during checkout:', err);
    res.status(500).json({ error: 'Failed to checkout' });
  }
});


const PORT = process.env.PORT || 3000;

(async () => {
  await syncModels(); // create tables if not exist
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})();

module.exports = { app, sequelize };
