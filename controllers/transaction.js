const moment = require("moment");
const Transaction = require("../models/transaction");
const Account = require("../models/account");
const { COMPLETED, PLANNED } = require("../constants");
const { OPERATION_INCOME } = require("../constants");

exports.getTransactions = async (req, res, next) => {
  const {
    businessId,
    queryData,
    type,
    category,
    account,
    contractor,
    project,
    status,
    currentPage,
    perPage,
  } = req.body;
  try {
    let query = {};
    if (businessId) query.business = businessId;
    if (queryData) query.date = queryData.createTime;
    if (type) query.type = type;
    if (category) query.category = category;
    if (account) query.account = account;
    if (contractor) query.contractor = contractor;
    if (project) query.project = project;
    if (status == COMPLETED) query.isPlanned = false;
    if (status == PLANNED) query.isPlanned = true;

    const transactions = await Transaction.find(query)
      .populate("account")
      .populate("project")
      .sort({ date: -1 });
    res.status(200).json({
      message: "Transactions fetched successfully.",
      transactions: transactions,
    });
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

exports.createTransaction = async (req, res, next) => {
  const { body } = req;
  const { businessId, date, type, amount, account } = req.body;

  try {
    const acc = await Account.findById(account);
    let amountLast = acc.balance;
    const startTransaction = await Transaction.find({
      business: businessId,
      date: { $lte: date },
    })
      .sort({ date: -1, createdAt: -1 })
      .limit(1);
    if (startTransaction.length > 0) {
      amountLast = parseFloat(startTransaction[0].accountBalance);
    }

    const accountBalance =
      type === OPERATION_INCOME ? amountLast + +amount : amountLast - amount;
    const isPlanned = moment(date) > moment() ? true : false;

    const transaction = new Transaction({
      business: body.businessId,
      date: body.date,
      type: body.type,
      category: body.category,
      project: body.project,
      contractor: body.contractor,
      amount: body.amount,
      account: body.account,
      description: body.description,
      relatedDate: body.relatedDate,
      isPlanned: isPlanned,
      isPeriodic: body.isPeriodic,
      period: body.period && body.period,
      repetitionEndDate: body.repetitionEndDate,
      isObligation: body.isObligation,
      accountBalance: accountBalance,
    });
    await transaction.save();
    await transaction.updateTransactionsBalanceOnCreate();

    if (!isPlanned) {
      acc.balance =
        type == OPERATION_INCOME
          ? +acc.balance + +amount
          : +acc.balance - amount;
      await acc.save();
      if (body.isObligation) {
        await transaction.attachObligation();
      }
    }

    if (body.isPeriodic) {
      transaction.rootOfPeriodicChain = true;
      transaction.periodicChainId = transaction._id;
      await transaction.save();
      await transaction.addPeriodicChain(acc);
    }
    res.status(201).json({
      message: "Transaction created!",
    });
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

exports.updateTransaction = async (req, res, next) => {
  const transactionId = req.params.transactionId;
  const { body } = req;
  const { businessId, date, amount, account } = req.body;

  try {
    const transaction = await Transaction.findById(transactionId);

    // transaction.category = body.category;
    // transaction.project = body.project;
    // transaction.contractor = body.contractor;
    // transaction.account = body.account;
    // transaction.description = body.description;
    // transaction.relatedDate = body.relatedDate;
    // transaction.repetitionEndDate = body.repetitionEndDate;
    // transaction.isObligation = body.isObligation;

    if (transaction.amount.toString() !== amount) {
      const diff = +amount - transaction.amount;
      transaction.date = date;
      transaction.amount = amount;
      await transaction.save();
      await transaction.updateTransactionsBalance(diff);
    }

    const transactionDate = moment(transaction.date).format("YYYY-MM-DD");
    if (transactionDate !== date) {
      let lowerBound, upperBound, range;

      if (moment(transaction.date) < moment(date)) {
        lowerBound = transaction.date;
        upperBound = date;
      } else {
        lowerBound = date;
        upperBound = transaction.date;
      }
      transaction.date = date;
      await transaction.save();
      range = await Transaction.getRangeInAsc(
        businessId,
        account,
        transaction._id,
        lowerBound,
        upperBound
      );
      await Transaction.updateBalanceInRange(range);
    }
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
  res.status(200).json({
    message: "Transaction updated.",
  });
};
