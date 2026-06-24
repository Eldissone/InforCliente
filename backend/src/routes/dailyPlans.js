const express = require("express");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { requirePermission, authRequired } = require("../middlewares/auth");
const dailyPlansRoutes = express.Router();

dailyPlansRoutes.use(authRequired);

// GET /daily-plans/all-pending
// Retorna planos pendentes de material globalmente (para o painel do armazém)
dailyPlansRoutes.get(
  "/all-pending",
  requirePermission("stock", "view"), // O armazém precisa ter acesso ao stock para ver
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const plans = await prisma.dailyPlan.findMany({
      where: { 
        status: { in: ["PENDING_MATERIAL", "PENDING_RETURN", "PENDING_VALIDATION"] },
        projectId: projectId || undefined
      },
      include: {
        project: true,
        tasks: {
          include: {
            progressTask: true,
            technician: true
          }
        },
        materials: {
          include: {
            product: true
          }
        }
      },
      orderBy: { date: "desc" }
    });

    res.json(plans);
  })
);

// GET /daily-plans/my-plans
// Action: Get all daily plans where the authenticated technician has at least one task assigned.
dailyPlansRoutes.get(
  "/my-plans",
  requirePermission("obras", "read"),
  asyncHandler(async (req, res) => {
    const technicianId = req.user.sub;

    const plans = await prisma.dailyPlan.findMany({
      where: {
        tasks: {
          some: {
            technicianId: technicianId
          }
        }
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            code: true
          }
        },
        tasks: {
          include: {
            progressTask: true,
            technician: true
          }
        },
        materials: {
          include: {
            product: true
          }
        }
      },
      orderBy: { date: "asc" }
    });

    res.json(plans);
  })
);

// POST /daily-plans/:id/start
// Action: Start the daily plan, changing status from DRAFT to IN_PROGRESS.
dailyPlansRoutes.post(
  "/:id/start",
  requirePermission("obras", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const plan = await prisma.dailyPlan.findUnique({
      where: { id }
    });

    if (!plan) return res.status(404).json({ error: "Plano Diário não encontrado." });

    if (plan.status !== "DRAFT") {
      return res.status(400).json({ error: `O plano diário não pode ser iniciado porque está no estado ${plan.status}.` });
    }

    const updated = await prisma.dailyPlan.update({
      where: { id },
      data: { status: "IN_PROGRESS" }
    });

    res.json({ success: true, plan: updated });
  })
);

// GET /daily-plans?projectId=...
dailyPlansRoutes.get(
  "/",
  requirePermission("obras", "read"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: "projectId is required" });

    const plans = await prisma.dailyPlan.findMany({
      where: { projectId },
      include: {
        tasks: {
          include: {
            progressTask: true,
            technician: true
          }
        },
        materials: {
          include: {
            product: true
          }
        }
      },
      orderBy: { date: "desc" }
    });

    res.json(plans);
  })
);

// GET /daily-plans/:id
dailyPlansRoutes.get(
  "/:id",
  requirePermission("obras", "read"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const plan = await prisma.dailyPlan.findUnique({
      where: { id },
      include: {
        project: true,
        tasks: {
          include: {
            progressTask: true,
            technician: true
          }
        },
        materials: {
          include: {
            product: true
          }
        }
      }
    });

    if (!plan) return res.status(404).json({ error: "Plano não encontrado" });
    res.json(plan);
  })
);

// POST /daily-plans
dailyPlansRoutes.post(
  "/",
  requirePermission("obras", "manage"),
  asyncHandler(async (req, res) => {
    const { projectId, date, description, tasks, materials } = req.body;
    
    if (!projectId || !date || !tasks || tasks.length === 0) {
      return res.status(400).json({ error: "projectId, date e tasks são obrigatórios." });
    }

    const plan = await prisma.dailyPlan.create({
      data: {
        projectId,
        date: new Date(date),
        description,
        status: "DRAFT", // ou PENDING_MATERIAL se tiver materiais
        tasks: {
          create: tasks.map(t => ({
            progressTaskId: t.progressTaskId,
            plannedQty: t.plannedQty,
            notes: t.notes,
            technicianId: t.technicianId || null
          }))
        },
        materials: materials && materials.length > 0 ? {
          create: materials.map(m => ({
            productId: m.productId,
            requestedQty: m.requestedQty
          }))
        } : undefined
      },
      include: { tasks: true, materials: true }
    });

    // Se tiver materiais, passa logo a PENDING_MATERIAL
    if (materials && materials.length > 0) {
      await prisma.dailyPlan.update({
        where: { id: plan.id },
        data: { status: "PENDING_MATERIAL" }
      });
    }

    res.status(201).json(plan);
  })
);

// PATCH /daily-plans/:id
dailyPlansRoutes.patch(
  "/:id",
  requirePermission("obras", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { date, description, tasks, materials } = req.body;
    
    const existing = await prisma.dailyPlan.findUnique({
      where: { id },
      include: { tasks: true, materials: true }
    });

    if (!existing) {
      return res.status(404).json({ error: "Plano Diário não encontrado." });
    }

    if (existing.status === "PENDING_VALIDATION" || existing.status === "COMPLETED") {
      return res.status(400).json({ error: "Não é possível editar um plano já concluído ou pendente de validação." });
    }

    // Determine what we can edit based on status
    const canEditMaterials = existing.status === "DRAFT" || existing.status === "PENDING_MATERIAL" || existing.status === "IN_PROGRESS";
    
    await prisma.$transaction(async (tx) => {
      // 1. Update basic info
      let newStatus = existing.status;
      
      const updateData = {};
      if (date) updateData.date = new Date(date);
      if (description !== undefined) updateData.description = description;

      // 2. Update Tasks
      if (tasks && Array.isArray(tasks)) {
        await tx.dailyPlanTask.deleteMany({ where: { dailyPlanId: id } });
        if (tasks.length > 0) {
          updateData.tasks = {
            create: tasks.map(t => ({
              progressTaskId: t.progressTaskId,
              plannedQty: t.plannedQty,
              notes: t.notes,
              technicianId: t.technicianId || null
            }))
          };
        }
      }

      // 3. Update Materials (Smart Update)
      if (canEditMaterials && materials !== undefined && Array.isArray(materials)) {
        const existingMats = existing.materials;
        
        // Find materials to delete (in existing, but not in payload)
        const toDelete = existingMats.filter(em => !materials.some(m => m.productId === em.productId));
        for (const delMat of toDelete) {
          await tx.dailyPlanMaterial.delete({ where: { id: delMat.id } });
          // Note: If providedQty > 0, stock is technically lost. In a full system, we'd refund stock here.
        }

        let needsMoreMaterial = false;

        // Upsert materials from payload
        for (const m of materials) {
          const exMat = existingMats.find(em => em.productId === m.productId);
          if (exMat) {
            // Update requestedQty
            await tx.dailyPlanMaterial.update({
              where: { id: exMat.id },
              data: { requestedQty: m.requestedQty }
            });
            if (m.requestedQty > exMat.providedQty) {
              needsMoreMaterial = true;
            }
          } else {
            // Create new
            await tx.dailyPlanMaterial.create({
              data: {
                dailyPlanId: id,
                productId: m.productId,
                requestedQty: m.requestedQty
              }
            });
            needsMoreMaterial = true;
          }
        }

        if (materials.length > 0 && newStatus === "DRAFT") {
          newStatus = "PENDING_MATERIAL";
        } else if (materials.length === 0 && newStatus === "PENDING_MATERIAL") {
          newStatus = "DRAFT";
        } else if (needsMoreMaterial && newStatus === "IN_PROGRESS") {
          // If we are in progress but need more materials, we must revert to pending_material
          // so the warehouse can provide the rest.
          newStatus = "PENDING_MATERIAL";
        }
      }

      if (newStatus !== existing.status) {
        updateData.status = newStatus;
      }

      await tx.dailyPlan.update({
        where: { id },
        data: updateData
      });
    });

    const updated = await prisma.dailyPlan.findUnique({
      where: { id },
      include: { tasks: true, materials: true }
    });

    res.json(updated);
  })
);

// POST /daily-plans/:id/start
// Action: Technician starts the daily plan.
dailyPlansRoutes.post(
  "/:id/start",
  requirePermission("obras", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const plan = await prisma.dailyPlan.findUnique({
      where: { id },
      include: { materials: true }
    });

    if (!plan) return res.status(404).json({ error: "Plano não encontrado" });
    
    let newStatus = "IN_PROGRESS";
    if (plan.status === "DRAFT" && plan.materials.length > 0 && !plan.receivedBy) {
       newStatus = "PENDING_MATERIAL";
    }

    const updated = await prisma.dailyPlan.update({
      where: { id },
      data: { status: newStatus }
    });

    res.json(updated);
  })
);

// DELETE /daily-plans/:id
dailyPlansRoutes.delete(
  "/:id",
  requirePermission("obras", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const plan = await prisma.dailyPlan.findUnique({ where: { id } });
    if (!plan) return res.status(404).json({ error: "Plano não encontrado" });

    if (plan.status === "IN_PROGRESS" || plan.status === "COMPLETED") {
      return res.status(400).json({ error: "Não pode apagar um plano já disponibilizado ou concluído." });
    }

    await prisma.dailyPlan.delete({ where: { id } });
    res.status(204).send();
  })
);

// POST /daily-plans/:id/provide-materials
// Action: Warehouse provides requested materials. Deducts from project's warehouse.
dailyPlansRoutes.post(
  "/:id/provide-materials",
  requirePermission("stock", "manage"), // Quem tem stock access
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { receivedBy, materials } = req.body;
    const activeUserId = req.user?.sub || "sistema";

    const plan = await prisma.dailyPlan.findUnique({
      where: { id },
      include: { materials: true, project: true }
    });

    if (!plan) return res.status(404).json({ error: "Plano não encontrado" });
    if (plan.status !== "PENDING_MATERIAL") return res.status(400).json({ error: "Estado do plano não permite esta ação." });

    // Descobrir qual é o armazém da Obra (Estaleiro)
    const estaleiro = await prisma.warehouse.findFirst({
      where: { projectId: plan.projectId }
    });

    if (!estaleiro) {
      return res.status(400).json({ error: "A obra não tem um estaleiro (armazém) associado." });
    }

    // Para cada material, deduzir do armazém e marcar como provided
    try {
      await prisma.$transaction(async (tx) => {
        for (const mat of plan.materials) {
          const alreadyProvided = Number(mat.providedQty || 0);
          const confirmedMat = materials?.find(m => m.productId === mat.productId);
          
          // Se o frontend enviar confirmedQty, ele representa a quantidade *adicional* a fornecer.
          // Caso não envie, assumimos que vamos fornecer todo o restante necessário.
          const additionalQty = confirmedMat 
              ? Number(confirmedMat.confirmedQty) 
              : Math.max(0, mat.requestedQty - alreadyProvided);

          if (additionalQty <= 0) {
            continue; // Já foi disponibilizado o suficiente ou o user confirmou 0
          }

          const newTotalProvided = alreadyProvided + additionalQty;

          await tx.dailyPlanMaterial.update({
            where: { id: mat.id },
            data: { providedQty: newTotalProvided }
          });

          await tx.stockMovement.create({
            data: {
              warehouseId: estaleiro.id,
              productId: mat.productId,
              projectId: plan.projectId,
              type: "EXIT",
              quantity: additionalQty,
              notes: `Disponibilizado para Plano Diario (ID: ${plan.id})${receivedBy ? ` - Recebido por: ${receivedBy}` : ''}`,
              userId: activeUserId
            }
          });

          // Procurar qualquer stock deste produto no estaleiro (independente de owner para simplificar em obra)
          const existingStock = await tx.warehouseStock.findFirst({
            where: {
              warehouseId: estaleiro.id,
              productId: mat.productId
            }
          });

          if (existingStock) {
            await tx.warehouseStock.update({
              where: { id: existingStock.id },
              data: { quantity: { decrement: additionalQty } }
            });
          } else {
            await tx.warehouseStock.create({
              data: {
                warehouseId: estaleiro.id,
                productId: mat.productId,
                quantity: -additionalQty,
                ownerId: null
              }
            });
          }
        }

        await tx.dailyPlan.update({
          where: { id },
          data: { 
            status: "DRAFT", // Material alocado mas o técnico ainda tem de iniciar a execução
            receivedBy: receivedBy || null
          }
        });
      });
      res.json({ success: true, message: "Materiais disponibilizados com sucesso." });
    } catch (error) {
      console.error("ERRO NO TRANSACTION provide-materials:", error);
      return res.status(500).json({ error: "Erro ao processar stock: " + error.message });
    }
  })
);

// POST /daily-plans/:id/receive
// Action: Technician confirms receipt of materials
dailyPlansRoutes.post(
  "/:id/receive",
  requirePermission("obras", "view"), // Technician can view/act on plans
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const activeUserName = req.user?.name || "Técnico";

    const plan = await prisma.dailyPlan.findUnique({
      where: { id }
    });

    if (!plan) return res.status(404).json({ error: "Plano não encontrado" });
    if (plan.status !== "DRAFT") return res.status(400).json({ error: "O plano não está pronto para recepção." });

    const updated = await prisma.dailyPlan.update({
      where: { id },
      data: { 
        technicianReceived: true,
        receivedBy: activeUserName
      }
    });

    res.json({ success: true, message: "Materiais recebidos com sucesso.", plan: updated });
  })
);

// POST /daily-plans/:id/complete
// Action: Technician marks plan as done, providing actual executed quantities and consumed materials.
// Note: This now sets status to PENDING_VALIDATION. Stock/Progress is only committed upon approval.
dailyPlansRoutes.post(
  "/:id/complete",
  requirePermission("obras", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { executedTasks, consumedMaterials, returnedBy } = req.body;
    // executedTasks: [{ dailyPlanTaskId, executedQty }]
    // consumedMaterials: [{ dailyPlanMaterialId, consumedQty }]

    const plan = await prisma.dailyPlan.findUnique({
      where: { id },
      include: { tasks: true, materials: true }
    });

    if (!plan) return res.status(404).json({ error: "Plano não encontrado" });
    if (plan.status !== "IN_PROGRESS" && plan.status !== "DRAFT") {
      return res.status(400).json({ error: "O plano não está em execução." });
    }

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Salvar Quantidades Reportadas nas Tasks (sem avançar o progresso geral ainda)
        if (executedTasks && executedTasks.length > 0) {
          for (const t of executedTasks) {
            const planTask = plan.tasks.find(pt => pt.id === t.dailyPlanTaskId);
            if (!planTask) continue;
            await tx.dailyPlanTask.update({
              where: { id: planTask.id },
              data: { executedQty: Number(t.executedQty || 0) }
            });
          }
        }

        // 2. Salvar Quantidades Reportadas de Materiais Consumidos (sem debitar stock ainda)
        if (consumedMaterials && consumedMaterials.length > 0) {
          for (const cm of consumedMaterials) {
            const planMat = plan.materials.find(pm => pm.id === cm.dailyPlanMaterialId);
            if (!planMat) continue;
            await tx.dailyPlanMaterial.update({
              where: { id: planMat.id },
              data: { consumedQty: Number(cm.consumedQty || 0) }
            });
          }
        }

        // 3. Mudar estado para PENDING_VALIDATION (Aguardando Validação)
        await tx.dailyPlan.update({
          where: { id },
          data: { 
            status: "PENDING_VALIDATION",
            returnedBy: returnedBy || null 
          }
        });
      });

      res.json({ success: true, message: "Relatório diário enviado com sucesso para validação do operador/gestor." });
    } catch (error) {
      console.error("ERRO NO TRANSACTION complete-plan:", error);
      res.status(500).json({ error: "Erro ao submeter plano: " + error.message });
    }
  })
);

// POST /daily-plans/:id/approve
// Action: Operator/Admin validates and approves the daily plan report, committing stock and progress changes.
dailyPlansRoutes.post(
  "/:id/approve",
  requirePermission("obras", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { validatedTasks, validatedMaterials } = req.body;
    // validatedTasks: [{ dailyPlanTaskId, executedQty }]
    // validatedMaterials: [{ dailyPlanMaterialId, consumedQty }]

    const activeUserId = req.user?.sub || "sistema";

    const plan = await prisma.dailyPlan.findUnique({
      where: { id },
      include: { tasks: true, materials: true }
    });

    if (!plan) return res.status(404).json({ error: "Plano não encontrado" });
    if (plan.status !== "PENDING_VALIDATION" && plan.status !== "IN_PROGRESS" && plan.status !== "DRAFT") {
      return res.status(400).json({ error: "Este plano não está pendente de validação." });
    }

    const estaleiro = await prisma.warehouse.findFirst({
      where: { projectId: plan.projectId }
    });

    let hasReturns = false;

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Confirmar e Processar Tasks e Avanço Físico
        const tasksToProcess = validatedTasks || plan.tasks.map(t => ({ dailyPlanTaskId: t.id, executedQty: t.executedQty }));
        for (const t of tasksToProcess) {
          const planTask = plan.tasks.find(pt => pt.id === t.dailyPlanTaskId);
          if (!planTask) continue;

          const qty = Number(t.executedQty || 0);

          await tx.dailyPlanTask.update({
            where: { id: planTask.id },
            data: { executedQty: qty }
          });

          if (qty > 0) {
            // Find current accumulated qty
            const currentProgress = await tx.projectProgressTask.findUnique({
              where: { id: planTask.progressTaskId }
            });
            const accumulatedQty = Number(currentProgress.executedQty) + qty;

            await tx.projectProgressTask.update({
              where: { id: planTask.progressTaskId },
              data: { executedQty: accumulatedQty }
            });

            // Get technician name if any
            let techName = null;
            if (planTask.technicianId) {
               const techUser = await tx.user.findUnique({ where: { id: planTask.technicianId } });
               if (techUser) techName = techUser.name || techUser.email;
            }

            // Create History Record
            await tx.projectProgressHistory.create({
              data: {
                projectId: plan.projectId,
                taskId: planTask.progressTaskId,
                date: plan.date,
                executedQty: qty,
                accumulatedQty: accumulatedQty,
                technicianName: techName,
                notes: planTask.notes || plan.description
              }
            });
          }
        }

        // 2. Confirmar e Processar Materiais Consumidos
        const materialsToProcess = validatedMaterials || plan.materials.map(m => ({ dailyPlanMaterialId: m.id, consumedQty: m.consumedQty }));

        if (estaleiro) {
          for (const cm of materialsToProcess) {
            const planMat = plan.materials.find(pm => pm.id === cm.dailyPlanMaterialId);
            if (!planMat) continue;

            const consQty = Number(cm.consumedQty || 0);
            const provided = Number(planMat.providedQty);
            
            await tx.dailyPlanMaterial.update({
              where: { id: planMat.id },
              data: { consumedQty: consQty }
            });

            // Se o consumo real foi inferior ao provido, marcamos como tendo devoluções
            if (consQty < provided) {
              hasReturns = true;
            }
          }
        }

        // 3. Mudar estado para COMPLETED ou PENDING_RETURN (apenas se a devolução ainda não tiver sido confirmada)
        await tx.dailyPlan.update({
          where: { id },
          data: { status: (hasReturns && !plan.returnConfirmedAt) ? "PENDING_RETURN" : "COMPLETED" }
        });
      });

      res.json({ success: true, message: "Plano Diário validado. " + (hasReturns ? "Aguardando devolução de materiais pela logística." : "Concluído com sucesso!") });
    } catch (error) {
      console.error("ERRO NO TRANSACTION approve-plan:", error);
      res.status(500).json({ error: "Erro ao aprovar plano: " + error.message });
    }
  })
);

// POST /daily-plans/:id/confirm-return
// Action: Logistics confirms the receipt of returned materials.
dailyPlansRoutes.post(
  "/:id/confirm-return",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { returnedBy } = req.body;
    const activeUserId = req.user?.sub || "sistema";

    if (!returnedBy) {
      return res.status(400).json({ error: "É obrigatório indicar quem fez a devolução." });
    }

    const plan = await prisma.dailyPlan.findUnique({
      where: { id },
      include: { materials: true, project: true }
    });

    if (!plan) return res.status(404).json({ error: "Plano não encontrado" });
    if (plan.status !== "PENDING_RETURN" && plan.status !== "PENDING_VALIDATION") {
      return res.status(400).json({ error: "Este plano não está pendente de validação ou devolução." });
    }
    if (plan.returnConfirmedAt) {
      return res.status(400).json({ error: "A devolução deste plano já foi confirmada anteriormente." });
    }

    const estaleiro = await prisma.warehouse.findFirst({
      where: { projectId: plan.projectId }
    });

    if (!estaleiro) {
      return res.status(400).json({ error: "O estaleiro não foi encontrado." });
    }

    try {
      await prisma.$transaction(async (tx) => {
        for (const mat of plan.materials) {
          const consQty = Number(mat.consumedQty || 0);
          const provided = Number(mat.providedQty || 0);

          // Fetch product to check category
          const product = await tx.product.findUnique({ where: { id: mat.productId } });
          const isTool = product?.category === 'TOOL' || product?.category === 'EQUIPMENT';

          // If tool/equipment and some units were reported as lost, create an EXIT movement to audit the loss
          if (isTool && consQty > 0) {
            await tx.stockMovement.create({
              data: {
                warehouseId: estaleiro.id,
                productId: mat.productId,
                projectId: plan.projectId,
                type: "EXIT",
                quantity: consQty,
                notes: `Ferramenta/Equipamento extraviado em obra (Plano Diário ${plan.id.slice(-6).toUpperCase()}) - Devolvido por: ${returnedBy}`,
                userId: activeUserId
              }
            });
          }

          if (consQty < provided) {
            const retorno = provided - consQty;

            await tx.stockMovement.create({
              data: {
                warehouseId: estaleiro.id,
                productId: mat.productId,
                projectId: plan.projectId,
                type: "ENTRY",
                quantity: retorno,
                notes: isTool
                  ? `Devolução de ferramenta/equipamento não extraviado (Plano ${plan.id}) - Devolvido por: ${returnedBy}`
                  : `Devolução de material não consumido (Plano ${plan.id}) - Devolvido por: ${returnedBy}`,
                userId: activeUserId
              }
            });

            const existingStock = await tx.warehouseStock.findFirst({
              where: {
                warehouseId: estaleiro.id,
                productId: mat.productId
              }
            });

            if (existingStock) {
              await tx.warehouseStock.update({
                where: { id: existingStock.id },
                data: { quantity: { increment: retorno } }
              });
            } else {
              await tx.warehouseStock.create({
                data: {
                  warehouseId: estaleiro.id,
                  productId: mat.productId,
                  quantity: retorno,
                  ownerId: null
                }
              });
            }
          }
        }

        await tx.dailyPlan.update({
          where: { id },
          data: { 
            status: plan.status === "PENDING_RETURN" ? "COMPLETED" : plan.status,
            returnedBy: returnedBy,
            returnConfirmedAt: new Date()
          }
        });
      });

      res.json({ success: true, message: "Devolução confirmada com sucesso!" });
    } catch (error) {
      console.error("ERRO NO TRANSACTION confirm-return:", error);
      res.status(500).json({ error: "Erro ao confirmar devolução: " + error.message });
    }
  })
);

module.exports = { dailyPlansRoutes };
