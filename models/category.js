const mongoose = require("mongoose");
const moment = require("moment");
const Schema = mongoose.Schema;
const Account = require("./account");
const Project = require("./project");
const Contractor = require("./contractor");
const Transaction = require("./transaction");
const ObjectId = mongoose.Types.ObjectId;

const {
  putCategoriesByActivity,
  getSkeletonForCategoryReport,
  constructReportByCategory,
  getEmptyCategoryTransactions,
} = require("../utils/category");

const {
  populateWithBuckets,
  calculateBalance,
  filterEmptyCategories,
} = require("../utils/functions");

const categorySchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  business: {
    type: Schema.Types.ObjectId,
    ref: "Business",
  },
  isOwnerTransfer: Boolean,
  kind: {
    type: Number,
    required: true,
  },
  type: {
    type: Number,
    required: true,
  },
  isSystem: {
    type: Boolean,
    default: false,
  },
});

categorySchema.statics.generateReportByCategory = async function ({
  businessId,
  queryData,
  countPlanned,
}) {
  const filterPlanned = countPlanned ? {} : { "transactions.isPlanned": false };

  const Category = mongoose.model("Category", categorySchema);

  const aggResult = await Category.aggregate([
    {
      $match: {
        business: ObjectId(businessId),
      },
    },
    {
      $lookup: {
        from: "transactions",
        localField: "_id",
        foreignField: "category",
        as: "transactions",
      },
    },
    {
      $unwind: "$transactions",
    },
    {
      $match: {
        "transactions.date": {
          $gte: new Date(queryData.createTime.$gte),
          $lte: new Date(queryData.createTime.$lte),
        },
        ...filterPlanned,
      },
    },
    {
      $project: {
        "transactions.isPlanned": 0,
        "transactions.isPeriodic": 0,
        "transactions.rootOfPeriodicChain": 0,
        "transactions.isObligation": 0,

        "transactions.business:": 0,
        "transactions.contractor": 0,
        "transactions.project": 0,
        "transactions.account:": 0,
        "transactions.createdAt": 0,
        "transactions.updatedAt:": 0,
        "transactions.accountBalance": 0,
      },
    },
    {
      $sort: { "transactions.date": 1 },
    },
    {
      $group: {
        _id: { category: "$_id" },
        kind: { $first: "$kind" },
        type: { $first: "$type" },
        name: { $first: "$name" },
        operations: { $push: "$transactions" },
      },
    },
    {
      $project: {
        kind: 1,
        type: 1,
        name: 1,
        incomeOperations: {
          $filter: {
            input: "$operations",
            as: "operation",
            cond: { $eq: ["$$operation.type", "income"] },
          },
        },
        outcomeOperations: {
          $filter: {
            input: "$operations",
            as: "operation",
            cond: { $eq: ["$$operation.type", "outcome"] },
          },
        },
      },
    },
  ]);
  console.log("1");

  await Account.populate(aggResult, {
    path: "operations.account",
    select: "name",
  });
  await Contractor.populate(aggResult, {
    path: "operations.contractor",
    select: "name",
  });
  await Project.populate(aggResult, {
    path: "operations.project",
    select: "name",
  });
  console.log("2");

  const emptyCategories = await getEmptyCategoryTransactions(
    businessId,
    countPlanned,
    queryData
  );
  console.log("3");
  aggResult.push(emptyCategories);

  const report = getSkeletonForCategoryReport(queryData);

  constructReportByCategory(aggResult, report, queryData);

  console.log("4");

  await Account.getMoneyInTheBeginning(businessId, countPlanned, report);
  await Account.getMoneyInTheEnd(businessId, countPlanned, report);

  console.log("5");

  calculateBalance(report);

  filterEmptyCategories(report);

  return report;
};

categorySchema.statics.generateReportByActivity = async function ({
  businessId,
  queryData,
  countPlanned,
}) {
  const filterPlanned = countPlanned ? {} : { "transactions.isPlanned": false };

  const Category = mongoose.model("Category", categorySchema);

  const aggResult = await Category.aggregate([
    {
      $match: {
        business: ObjectId(businessId),
      },
    },
    {
      $lookup: {
        from: "transactions",
        localField: "_id",
        foreignField: "category",
        as: "transactions",
      },
    },
    {
      $unwind: "$transactions",
    },
    {
      $match: {
        "transactions.date": {
          $gte: new Date(queryData.createTime.$gte),
          $lte: new Date(queryData.createTime.$lte),
        },
        ...filterPlanned,
      },
    },
    {
      $project: {
        "transactions.isPlanned": 0,
        "transactions.isPeriodic": 0,
        "transactions.rootOfPeriodicChain": 0,
        "transactions.isObligation": 0,

        "transactions.business:": 0,
        "transactions.contractor": 0,
        "transactions.project": 0,
        "transactions.account:": 0,
        "transactions.createdAt": 0,
        "transactions.updatedAt:": 0,
        "transactions.accountBalance": 0,
      },
    },
    {
      $group: {
        _id: { category: "$_id" },
        kind: { $first: "$kind" },
        type: { $first: "$type" },
        name: { $first: "$name" },
        operations: { $push: "$transactions" },
      },
    },
    {
      $project: {
        kind: 1,
        type: 1,
        name: 1,
        incomeOperations: {
          $filter: {
            input: "$operations",
            as: "operation",
            cond: { $eq: ["$$operation.type", "income"] },
          },
        },
        outcomeOperations: {
          $filter: {
            input: "$operations",
            as: "operation",
            cond: { $eq: ["$$operation.type", "outcome"] },
          },
        },
      },
    },
  ]);

  const emptyCategories = await getEmptyCategoryTransactions(
    businessId,
    countPlanned,
    queryData
  );
  aggResult.push(emptyCategories);

  const activities = putCategoriesByActivity(aggResult, queryData);

  constructReportByCategory(
    activities.financial.categories,
    activities.financial.report,
    queryData
  );
  constructReportByCategory(
    activities.operational.categories,
    activities.operational.report,
    queryData
  );
  constructReportByCategory(
    activities.investment.categories,
    activities.investment.report,
    queryData
  );

  calculateBalance(activities.financial.report);
  calculateBalance(activities.operational.report);
  calculateBalance(activities.investment.report);

  filterEmptyCategories(activities.financial.report);
  filterEmptyCategories(activities.operational.report);
  filterEmptyCategories(activities.investment.report);

  delete activities.financial.categories;
  delete activities.operational.categories;
  delete activities.investment.categories;

  await Account.getMoneyInTheBeginning(businessId, countPlanned, activities);
  await Account.getMoneyInTheEnd(businessId, countPlanned, activities);

  return activities;
};

module.exports = mongoose.model("Category", categorySchema);
